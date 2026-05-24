import type {
  ToolDef,
  ToolInfo,
  RunResult,
  SearchHit,
  ParametersSchema,
} from "./types.js";
import { Bm25 } from "./bm25.js";

/** Map Python type → JSON Schema type string */
function jsTypeToSchema(t: string): ParametersSchema[string]["type"] {
  const map: Record<string, ParametersSchema[string]["type"]> = {
    number: "number",
    string: "string",
    boolean: "boolean",
    object: "object",
    undefined: "string",
  };
  return map[t] ?? "string";
}

/**
 * Central tool registry.
 *
 * Tools are registered via `register()`.
 * The three public operations:
 *   - getAllTools()      → ToolInfo[]
 *   - searchTools(q, n)  → SearchHit[]   (regex filter → BM25 rank)
 *   - runTool(name, args) → RunResult
 */
class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private bm25 = new Bm25();
  private idSeq = 0;
  private idToName = new Map<number, string>();

  /** Register a tool (plain object — no decorators needed in TS) */
  register(def: ToolDef): void {
    this.tools.set(def.name, def);

    // Index into BM25
    const text = `${def.name} ${def.description}`;
    const id = this.idSeq++;
    this.idToName.set(id, def.name);
    this.bm25.addDoc(id, text);
  }

  // ── Public API ──────────────────────────────────────

  /** Return all tools (no handlers, no scoring) */
  getAllTools(): ToolInfo[] {
    const out: ToolInfo[] = [];
    for (const [, t] of this.tools) {
      out.push({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      });
    }
    return out;
  }

  /**
   * Search tools by query.
   *
   * Phase 1 — regex filter: match `query` as a regex against name + description.
   *   If query isn't a valid regex, treat it as a literal substring.
   * Phase 2 — BM25 re-ranking of the filtered set.
   *
   * Returns top `limit` hits, ordered by BM25 score descending.
   */
  searchTools(query: string, limit: number = 20): SearchHit[] {
    const q = query.trim();
    if (!q) return this._allScored(limit);

    // Phase 1: filter — regex for meta chars, fuzzy token match otherwise
    const hasMeta = /[|\[\](){}$^*+.?\\]/.test(q);
    const filtered: { name: string; text: string }[] = [];

    if (hasMeta) {
      let regex: RegExp;
      try {
        regex = new RegExp(q, "i");
      } catch {
        regex = new RegExp(escapeRegex(q), "i");
      }
      for (const [, t] of this.tools) {
        const text = `${t.name} ${t.description}`;
        if (regex.test(text)) {
          filtered.push({ name: t.name, text });
        }
      }
    } else {
      const qTokens = tokenize(q);
      for (const [, t] of this.tools) {
        const text = `${t.name} ${t.description}`;
        if (looseTokenMatch(qTokens, tokenize(text))) {
          filtered.push({ name: t.name, text });
        }
      }
    }

    if (filtered.length === 0) return [];

    // Phase 2: rebuild BM25 with only filtered docs (keeps IDF meaningful)
    const localBm25 = new Bm25();
    localBm25.index(filtered.map((f, i) => ({ id: i, text: f.text })));

    const scored = localBm25.search(q);
    const hits: SearchHit[] = [];

    if (scored.length > 0) {
      for (const s of scored.slice(0, limit)) {
        const name = filtered[s.id].name;
        const t = this.tools.get(name)!;
        hits.push({
          tool: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
          score: s.score,
        });
      }
    } else {
      // BM25 didn't score any tokens (e.g. regex patterns with | or []) —
      // fall back to returning all regex-filtered results with zero score.
      for (const f of filtered.slice(0, limit)) {
        const t = this.tools.get(f.name)!;
        hits.push({
          tool: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
          score: 0,
        });
      }
    }

    return hits;
  }

  /** Run a tool by name with given arguments */
  async runTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<RunResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      const available = [...this.tools.keys()].slice(0, 15);
      return {
        tool: toolName,
        input: args,
        result: null,
        status: "error",
        error: `Инструмент '${toolName}' не найден. Доступные: ${available.join(", ")}`,
      };
    }

    try {
      const result = await tool.fn(args);
      return { tool: toolName, input: args, result, status: "success" };
    } catch (e: any) {
      return {
        tool: toolName,
        input: args,
        result: null,
        status: "error",
        error: e?.message ?? String(e),
      };
    }
  }

  // ── helpers ─────────────────────────────────────────

  /** All tools scored by BM25 relevance to query */
  private _allScored(limit: number): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const [, t] of this.tools) {
      hits.push({
        tool: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
        score: 0,
      });
    }
    return hits.slice(0, limit);
  }
}

/** Escape string for use inside RegExp */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Tokenize: split on non-alphanumeric (including Cyrillic), lowercase, drop empties */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter(Boolean);
}

/**
 * Loose token match: true if any query token loosely matches any doc token.
 * "Loose" = exact match, substring in either direction, or shared prefix ≥3 chars.
 */
function looseTokenMatch(qTokens: string[], dTokens: string[]): boolean {
  for (const qt of qTokens) {
    for (const dt of dTokens) {
      if (qt === dt) return true;
      if (qt.includes(dt) || dt.includes(qt)) return true;
      // shared prefix: handles inflection (погода ↔ погоду)
      const minLen = Math.min(qt.length, dt.length);
      let i = 0;
      while (i < minLen && qt[i] === dt[i]) i++;
      if (i >= Math.max(3, minLen * 0.7)) return true;
    }
  }
  return false;
}

/** Singleton */
export const registry = new ToolRegistry();

/**
 * Decorator-style helper: registers a function as a tool.
 * Extracts parameter schema from a user-supplied schema object.
 *
 * Usage:
 *   registerTool("add", "Складывает два числа", { a: { type: "integer" }, b: { type: "integer" } }, ["a","b"], addFn);
 */
export function registerTool(
  name: string,
  description: string,
  params: ParametersSchema,
  required: string[],
  fn: (...args: any[]) => any,
): void {
  registry.register({ name, description, parameters: params, required, fn });
}

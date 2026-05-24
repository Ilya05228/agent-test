/**
 * UnifiedRegistry — merges internal tools (from registry.ts) with
 * external tools (from discovery.ts) into a single searchable index.
 */
import { registry as internalRegistry } from "./registry.js";
import { Bm25 } from "./bm25.js";
import type { ExternalTool, McpDiscovery } from "./discovery.js";
import type { ToolInfo, SearchHit, RunResult } from "./types.js";

// ── Internal external-tool wrapper ───────────────────────

interface IndexedTool {
  /** "add" or "git::git_status" */
  qualifiedName: string;
  /** The tool name itself ("add", "git_status") */
  toolName: string;
  /** Server name for external, empty for internal */
  serverName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** true if this is an external tool */
  external: boolean;
}

// ── Unified Registry ──────────────────────────────────────

export class UnifiedRegistry {
  private externalTools = new Map<string, IndexedTool>();
  private bm25 = new Bm25();
  private idSeq = 0;
  private idToEntry = new Map<number, IndexedTool>();

  constructor(private discovery: McpDiscovery) {}

  /** Index a batch of external tools (e.g. after discovery) */
  indexExternal(tools: ExternalTool[]): void {
    for (const t of tools) {
      const entry: IndexedTool = {
        qualifiedName: t.qualifiedName,
        toolName: t.toolName,
        serverName: t.serverName,
        description: t.description,
        inputSchema: t.inputSchema,
        external: true,
      };
      this.externalTools.set(t.qualifiedName, entry);

      // BM25
      const text = `${t.qualifiedName} ${t.description}`;
      const id = this.idSeq++;
      this.idToEntry.set(id, entry);
      this.bm25.addDoc(id, text);
    }

    // Re-index internal tools into the same BM25
    for (const t of internalRegistry.getAllTools()) {
      const text = `${t.name} ${t.description}`;
      const id = this.idSeq++;
      this.idToEntry.set(id, {
        qualifiedName: t.name,
        toolName: t.name,
        serverName: "",
        description: t.description,
        inputSchema: t.parameters as Record<string, unknown>,
        external: false,
      });
      this.bm25.addDoc(id, text);
    }
  }

  /** Return all tools (internal + external) as ToolInfo[] */
  getAllTools(): ToolInfo[] {
    const out: ToolInfo[] = [];

    // Internal
    for (const t of internalRegistry.getAllTools()) {
      out.push(t);
    }

    // External
    for (const [, e] of this.externalTools) {
      out.push({
        name: e.qualifiedName,
        description: `[${e.serverName}] ${e.description}`,
        parameters: e.inputSchema as ToolInfo["parameters"],
      });
    }

    return out;
  }

  /**
   * Search across internal + external tools.
   * Same dual-mode logic as registry.ts but over the unified BM25 index.
   */
  searchTools(query: string, limit: number = 20): SearchHit[] {
    const q = query.trim();
    if (!q) return this._allScored(limit);

    const hasMeta = /[|\[\](){}$^*+.?\\]/.test(q);
    const allEntries: IndexedTool[] = [];

    // Phase 1: filter
    if (hasMeta) {
      let regex: RegExp;
      try {
        regex = new RegExp(q, "i");
      } catch {
        regex = new RegExp(escapeRegex(q), "i");
      }
      for (const [, e] of this._allEntries()) {
        const text = `${e.qualifiedName} ${e.description}`;
        if (regex.test(text)) allEntries.push(e);
      }
    } else {
      const qTokens = tokenize(q);
      for (const [, e] of this._allEntries()) {
        const text = `${e.qualifiedName} ${e.description}`;
        if (looseTokenMatch(qTokens, tokenize(text))) allEntries.push(e);
      }
    }

    if (allEntries.length === 0) return [];

    // Phase 2: BM25 re-rank on filtered set
    const localBm25 = new Bm25();
    localBm25.index(
      allEntries.map((e, i) => ({
        id: i,
        text: `${e.qualifiedName} ${e.description}`,
      })),
    );

    const scored = localBm25.search(q);
    const hits: SearchHit[] = [];

    if (scored.length > 0) {
      for (const s of scored.slice(0, limit)) {
        const e = allEntries[s.id];
        hits.push(this._toHit(e, s.score));
      }
    } else {
      for (const e of allEntries.slice(0, limit)) {
        hits.push(this._toHit(e, 0));
      }
    }

    return hits;
  }

  /** Run a tool — dispatches to internal or external */
  async runTool(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<RunResult> {
    // Check external first (has "::")
    const doubleColon = qualifiedName.indexOf("::");
    if (doubleColon > 0) {
      const serverName = qualifiedName.slice(0, doubleColon);
      const toolName = qualifiedName.slice(doubleColon + 2);
      try {
        const result = await this.discovery.callExternalTool(serverName, toolName, args);
        return {
          tool: qualifiedName,
          input: args,
          result,
          status: "success",
        };
      } catch (e: any) {
        return {
          tool: qualifiedName,
          input: args,
          result: null,
          status: "error",
          error: e?.message ?? String(e),
        };
      }
    }

    // Internal
    return internalRegistry.runTool(qualifiedName, args);
  }

  // ── private ──────────────────────────────────────────

  private _allEntries(): Map<string, IndexedTool> {
    const all = new Map<string, IndexedTool>();
    for (const [, e] of this.externalTools) all.set(e.qualifiedName, e);
    for (const t of internalRegistry.getAllTools()) {
      all.set(t.name, {
        qualifiedName: t.name,
        toolName: t.name,
        serverName: "",
        description: t.description,
        inputSchema: t.parameters as Record<string, unknown>,
        external: false,
      });
    }
    return all;
  }

  private _allScored(limit: number): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const [, e] of this._allEntries()) {
      hits.push(this._toHit(e, 0));
    }
    return hits.slice(0, limit);
  }

  private _toHit(e: IndexedTool, score: number): SearchHit {
    return {
      tool: {
        name: e.qualifiedName,
        description: e.external ? `[${e.serverName}] ${e.description}` : e.description,
        parameters: e.inputSchema as ToolInfo["parameters"],
      },
      score,
    };
  }
}

// ── Helpers (mirrored from registry.ts) ────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter(Boolean);
}

function looseTokenMatch(qTokens: string[], dTokens: string[]): boolean {
  for (const qt of qTokens) {
    for (const dt of dTokens) {
      if (qt === dt) return true;
      if (qt.includes(dt) || dt.includes(qt)) return true;
      const minLen = Math.min(qt.length, dt.length);
      let i = 0;
      while (i < minLen && qt[i] === dt[i]) i++;
      if (i >= Math.max(3, minLen * 0.7)) return true;
    }
  }
  return false;
}

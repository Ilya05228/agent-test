/**
 * MetaTools Pro — MCP stdio gateway server.
 *
 * Exposes TWO MCP tools:
 *   search_tools — regex + BM25 поиск по ВСЕМ инструментам (внутренние + внешние MCP-серверы)
 *   run_tool     — запуск инструмента (диспетчеризация: внутренний или внешний)
 *
 * При старте читает .omp/mcp.json, подключается к внешним серверам,
 * получает их tools/list и добавляет в единый индекс.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Side-effect: регистрирует внутренние инструменты
import "./tools/add.js";
import "./tools/multiply.js";
import "./tools/get_weather.js";
import "./tools/search_web.js";
import "./tools/calculate_discount.js";
import "./tools/generate_password.js";
import "./tools/get_current_time.js";
import "./tools/summarize_text.js";
import "./tools/translate_text.js";
import "./tools/analyze_sentiment.js";
import "./tools/chat_with_deepseek.js";

import { McpDiscovery } from "./discovery.js";
import { UnifiedRegistry } from "./unified-registry.js";

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Init ────────────────────────────────────────────────────

const discovery = new McpDiscovery();
const unified = new UnifiedRegistry(discovery);

// mcp.json — ищем от __dirname вверх (dist/ → .omp/tools/ → project/)
function findMcpJson(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, ".omp", "mcp.json");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const configPath = findMcpJson(__dirname);


// ── Server ──────────────────────────────────────────────────

const server = new Server(
  { name: "metatools-pro-ts", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ── tools/list ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_tools",
      description:
        "Поиск инструментов по названию или описанию. " +
        "Ищет среди внутренних инструментов и инструментов внешних MCP-серверов. " +
        "Поддерживает regex (|, [], etc.) и нечёткий токен-матч. " +
        "Внешние инструменты имеют префикс server::tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Поисковый запрос или regex" },
          limit: {
            type: "integer",
            description: "Максимальное количество результатов",
            default: 20,
          },
        },
      },
    },
    {
      name: "run_tool",
      description:
        "Универсальный запуск любого инструмента по имени. " +
        "Для внешних инструментов используй формат server::tool. " +
        "Предварительно используй search_tools чтобы узнать какие инструменты есть и какие у них параметры.",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "Имя инструмента (или server::tool для внешних)" },
          arguments: {
            type: "object",
            description: "Аргументы инструмента (ключ-значение)",
          },
        },
        required: ["tool_name", "arguments"],
      },
    },
  ],
}));

// ── tools/call ──────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case "search_tools": {
      const q = (args?.query as string) ?? "";
      const limit = (args?.limit as number) ?? 20;
      const hits = unified.searchTools(q, limit);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(hits, null, 2) }],
      };
    }

    case "run_tool": {
      const toolName = args?.tool_name as string | undefined;
      const toolArgs = (args?.arguments as Record<string, unknown>) ?? {};

      if (!toolName) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "tool_name обязателен",
                available_tools: unified.getAllTools().map((t) => t.name),
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await unified.runTool(toolName, toolArgs);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: result.status === "error",
      };
    }

    default:
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ── Startup ─────────────────────────────────────────────────

async function main() {
  // Discover external MCP servers
  if (configPath) {
    console.error(`[gateway] Discovering external servers from ${configPath}`);
    const externalTools = await discovery.discoverFromConfig(configPath, ["metatools-pro-ts"]);
    console.error(`[gateway] Total external tools discovered: ${externalTools.length}`);

    // Index into unified registry
    unified.indexExternal(externalTools);
  } else {
    console.error(`[gateway] No mcp.json found, internal tools only`);
    unified.indexExternal([]); // Index just internal
  }

  const total = unified.getAllTools().length;
  console.error(`[gateway] Total tools available: ${total}`);

  // Start stdio MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[gateway] MCP server ready (stdio)");
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("[gateway] Shutting down...");
  await discovery.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("[gateway] Shutting down...");
  await discovery.shutdown();
  process.exit(0);
});

main().catch((e) => {
  console.error("[gateway] Fatal:", e);
  process.exit(1);
});

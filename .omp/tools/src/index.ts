/**
 * MetaTools Pro (TypeScript)
 *
 * MCP-совместимый шлюз: те же 2 «физических» MCP-тула, внутри — 11 виртуальных.
 *
 * Публичный API:
 *   getAllTools()           → ToolInfo[]
 *   searchTools(q, limit?)  → SearchHit[]   (regex → BM25)
 *   runTool(name, args)     → RunResult
 */

// Импорт всех инструментов — срабатывает registerTool() при загрузке модуля
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

import { registry } from "./registry.js";

export const getAllTools = () => registry.getAllTools();
export const searchTools = (query: string, limit?: number) =>
  registry.searchTools(query, limit);
export const runTool = (name: string, args: Record<string, unknown>) =>
  registry.runTool(name, args);

export type { ToolInfo, SearchHit, RunResult, ParametersSchema } from "./types.js";

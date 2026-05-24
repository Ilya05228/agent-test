/** JSON Schema-like parameter descriptor */
export interface ParamSchema {
  type: "string" | "integer" | "number" | "boolean" | "object" | "array";
  description?: string;
  default?: unknown;
}

/** Parameter map as used in JSON Schema properties */
export type ParametersSchema = Record<string, ParamSchema>;

/** Internal tool definition */
export interface ToolDef {
  name: string;
  description: string;
  parameters: ParametersSchema;
  required: string[];
  fn: (...args: any[]) => any | Promise<any>;
}

/** Public-facing tool info (no handler) */
export interface ToolInfo {
  name: string;
  description: string;
  parameters: ParametersSchema;
}

/** Result from runTool */
export interface RunResult {
  tool: string;
  input: Record<string, unknown>;
  result: unknown;
  status: "success" | "error";
  error?: string;
}

/** BM25-scored search hit */
export interface SearchHit {
  tool: ToolInfo;
  score: number;
}

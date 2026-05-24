import { registerTool } from "../registry.js";

registerTool(
  "multiply",
  "Умножает два числа",
  {
    a: { type: "integer", description: "Первый множитель" },
    b: { type: "integer", description: "Второй множитель" },
  },
  ["a", "b"],
  (args: Record<string, unknown>) => {
    return (args.a as number) * (args.b as number);
  },
);

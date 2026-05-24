import { registerTool } from "../registry.js";

registerTool(
  "add",
  "Складывает два числа",
  {
    a: { type: "integer", description: "Первое слагаемое" },
    b: { type: "integer", description: "Второе слагаемое" },
  },
  ["a", "b"],
  (args: Record<string, unknown>) => {
    return (args.a as number) + (args.b as number);
  },
);

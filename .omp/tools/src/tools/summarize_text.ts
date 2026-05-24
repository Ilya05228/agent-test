import { registerTool } from "../registry.js";

registerTool(
  "summarize_text",
  "Краткое изложение текста",
  {
    text: { type: "string", description: "Исходный текст" },
    max_length: { type: "integer", description: "Макс. длина результата", default: 200 },
  },
  ["text"],
  (args: Record<string, unknown>) => {
    const text = args.text as string;
    const max = (args.max_length as number) ?? 200;
    if (text.length <= max) return text;
    const cut = text.lastIndexOf(" ", max);
    return text.slice(0, cut > 0 ? cut : max) + "...";
  },
);

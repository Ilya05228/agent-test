import { registerTool } from "../registry.js";

registerTool(
  "translate_text",
  "Перевод текста (симуляция)",
  {
    text: { type: "string", description: "Текст для перевода" },
    target_lang: { type: "string", description: "Целевой язык", default: "en" },
  },
  ["text"],
  (args: Record<string, unknown>) => {
    const text = args.text as string;
    const lang = ((args.target_lang as string) || "en").toUpperCase();
    return `[Перевод на ${lang}]: ${text}`;
  },
);

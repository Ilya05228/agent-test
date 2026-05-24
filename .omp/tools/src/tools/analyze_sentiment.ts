import { registerTool } from "../registry.js";

registerTool(
  "analyze_sentiment",
  "Анализ тональности",
  {
    text: { type: "string", description: "Текст для анализа" },
  },
  ["text"],
  (args: Record<string, unknown>) => {
    const text = (args.text as string).toLowerCase();
    const pos = ["хорош", "отлич", "прекрас", "замечатель", "рад", "супер", "любл", "крут"];
    const neg = ["плох", "ужас", "отвратитель", "груст", "зл", "ненавиж", "бесит"];

    let score = 0;
    for (const w of pos) if (text.includes(w)) score += 1;
    for (const w of neg) if (text.includes(w)) score -= 1;

    let label: string;
    if (score > 0) label = "positive";
    else if (score < 0) label = "negative";
    else label = "neutral";

    return { label, score };
  },
);

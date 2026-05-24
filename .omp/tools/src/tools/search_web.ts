import { registerTool } from "../registry.js";

registerTool(
  "search_web",
  "Поиск в интернете (симуляция)",
  {
    query: { type: "string", description: "Поисковый запрос" },
    max_results: { type: "integer", description: "Макс. результатов", default: 5 },
  },
  ["query"],
  (args: Record<string, unknown>) => {
    const max = (args.max_results as number) ?? 5;
    const results = [
      { title: "Результат 1", url: "https://example.com/1", snippet: "Сниппет 1..." },
      { title: "Результат 2", url: "https://example.com/2", snippet: "Сниппет 2..." },
      { title: "Результат 3", url: "https://example.com/3", snippet: "Сниппет 3..." },
      { title: "Результат 4", url: "https://example.com/4", snippet: "Сниппет 4..." },
      { title: "Результат 5", url: "https://example.com/5", snippet: "Сниппет 5..." },
    ];
    return results.slice(0, max);
  },
);

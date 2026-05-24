import { registerTool } from "../registry.js";

registerTool(
  "get_weather",
  "Возвращает погоду (симуляция)",
  {
    city: { type: "string", description: "Название города" },
  },
  ["city"],
  (args: Record<string, unknown>) => {
    const city = args.city as string;
    const conditions = ["ясно", "облачно", "дождь", "снег", "туман"];
    return {
      city,
      temp: Math.round(10 + Math.random() * 25),
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      humidity: Math.round(30 + Math.random() * 60),
      timestamp: new Date().toISOString(),
    };
  },
);

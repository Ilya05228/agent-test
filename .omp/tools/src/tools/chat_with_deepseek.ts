import { registerTool } from "../registry.js";

registerTool(
  "chat_with_deepseek",
  "Отправляет запрос к DeepSeek API и возвращает ответ",
  {
    prompt: { type: "string", description: "Текст запроса" },
    system_prompt: {
      type: "string",
      description: "Системный промпт",
      default: "You are a helpful assistant.",
    },
    temperature: { type: "number", description: "Температура", default: 0.7 },
    max_tokens: { type: "integer", description: "Макс. токенов", default: 1024 },
    model: { type: "string", description: "Модель", default: "deepseek-chat" },
  },
  ["prompt"],
  async (args: Record<string, unknown>) => {
    const model = (args.model as string) || "deepseek-chat";
    const prompt = args.prompt as string;

    // Если DEEPSEEK_API_KEY не задан — симулируем
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return {
        status: "simulated",
        model,
        prompt,
        response: `[DeepSeek ${model}]: Это симулированный ответ на запрос "${prompt.slice(0, 80)}..."`,
      };
    }

    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: args.system_prompt || "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
        temperature: (args.temperature as number) ?? 0.7,
        max_tokens: (args.max_tokens as number) ?? 1024,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { status: "error", model, prompt, error: err };
    }

    const data = (await resp.json()) as any;
    return {
      status: "success",
      model,
      prompt,
      response: data.choices?.[0]?.message?.content ?? "[пустой ответ]",
    };
  },
);

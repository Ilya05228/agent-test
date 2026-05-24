import { registerTool } from "../registry.js";

registerTool(
  "calculate_discount",
  "Расчёт цены со скидкой",
  {
    price: { type: "number", description: "Исходная цена" },
    discount_percent: { type: "number", description: "Процент скидки" },
  },
  ["price", "discount_percent"],
  (args: Record<string, unknown>) => {
    const price = args.price as number;
    const pct = args.discount_percent as number;
    const discounted = Math.round(price * (1 - pct / 100) * 100) / 100;
    return {
      original_price: price,
      discount_percent: pct,
      discounted_price: discounted,
      savings: Math.round((price - discounted) * 100) / 100,
    };
  },
);

import { registerTool } from "../registry.js";
import crypto from "node:crypto";

registerTool(
  "generate_password",
  "Генерация надёжного пароля",
  {
    length: { type: "integer", description: "Длина пароля", default: 16 },
    include_symbols: { type: "boolean", description: "Включать спецсимволы", default: true },
  },
  [],
  (args: Record<string, unknown>) => {
    const length = (args.length as number) ?? 16;
    const includeSymbols = (args.include_symbols as boolean) ?? true;
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const digits = "0123456789";
    const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    const chars = letters + digits + (includeSymbols ? symbols : "");

    const buf = crypto.randomBytes(length);
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[buf[i] % chars.length];
    }
    return result;
  },
);

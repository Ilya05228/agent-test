import { registerTool } from "../registry.js";

registerTool(
  "get_current_time",
  "Текущее время",
  {
    timezone: { type: "string", description: "Часовой пояс (напр. UTC, Europe/Moscow)", default: "UTC" },
  },
  [],
  (args: Record<string, unknown>) => {
    const tz = (args.timezone as string) || "UTC";
    const now = new Date();
    try {
      const str = now.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
      return `${str.replace(" ", "T")} ${tz}`;
    } catch {
      return `${now.toISOString()} UTC`;
    }
  },
);

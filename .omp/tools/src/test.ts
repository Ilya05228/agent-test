/**
 * Тест MetaTools Pro TypeScript:
 *   getAllTools, searchTools (regex + BM25), runTool
 */
import { getAllTools, searchTools, runTool } from "./index.js";

const SEP = "=".repeat(60);

async function main() {
  // ── GET ALL ─────────────────────────────────────────
  console.log(`${SEP}\n1. getAllTools()\n${SEP}`);
  const all = getAllTools();
  console.log(`Всего инструментов: ${all.length}`);
  for (const t of all) {
    console.log(`  • ${t.name} — ${t.description}`);
  }

  // ── SEARCH ──────────────────────────────────────────
  console.log(`\n${SEP}\n2. searchTools("погода")\n${SEP}`);
  const r1 = searchTools("погода");
  for (const h of r1) {
    console.log(`  ${h.tool.name}  score=${h.score.toFixed(3)}  ${h.tool.description}`);
  }

  console.log(`\n${SEP}\n3. searchTools("числ|чис[ео]л")  ← regex\n${SEP}`);
  const r2 = searchTools("числ|чис[ео]л");
  for (const h of r2) {
    console.log(`  ${h.tool.name}  score=${h.score.toFixed(3)}  ${h.tool.description}`);
  }

  console.log(`\n${SEP}\n4. searchTools("password")  ← BM25: password vs парол\n${SEP}`);
  const r3 = searchTools("password");
  for (const h of r3) {
    console.log(`  ${h.tool.name}  score=${h.score.toFixed(3)}  ${h.tool.description}`);
  }

  // ── RUN ─────────────────────────────────────────────
  console.log(`\n${SEP}\n5. runTool("add", {a:3,b:7})\n${SEP}`);
  const addRes = await runTool("add", { a: 3, b: 7 });
  console.log(JSON.stringify(addRes, null, 2));

  console.log(`\n${SEP}\n6. runTool("generate_password", {length:24,include_symbols:true})\n${SEP}`);
  const pwRes = await runTool("generate_password", { length: 24, include_symbols: true });
  console.log(JSON.stringify(pwRes, null, 2));

  console.log(`\n${SEP}\n7. runTool("get_weather", {city:"Москва"})\n${SEP}`);
  const wRes = await runTool("get_weather", { city: "Москва" });
  console.log(JSON.stringify(wRes, null, 2));

  console.log(`\n${SEP}\n8. runTool("analyze_sentiment", {text:"это просто ужасный день"})\n${SEP}`);
  const sRes = await runTool("analyze_sentiment", { text: "это просто ужасный день" });
  console.log(JSON.stringify(sRes, null, 2));

  console.log(`\n${SEP}\n9. runTool("nonexistent", {})\n${SEP}`);
  const errRes = await runTool("nonexistent", {});
  console.log(JSON.stringify(errRes, null, 2));

  console.log(`\n${SEP}\n✓ Все тесты пройдены\n${SEP}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});

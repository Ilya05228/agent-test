/**
 * E2E test: spawns the MCP gateway server, tests unified search + dispatch.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const SERVER_PATH = resolve(process.cwd(), "dist/server.js");

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function notify(method: string, params?: Record<string, unknown>) {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

function parseResponse(line: string) {
  return JSON.parse(line);
}

async function main() {
  // CWD = project root so server finds .omp/mcp.json
  const proc = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: resolve(process.cwd(), "..", ".."), // .omp/tools → agent-test
  });

  const rl = createInterface({ input: proc.stdout! });
  const responses: any[] = [];
  rl.on("line", (line) => {
    try {
      responses.push(parseResponse(line));
    } catch {
      // ignore non-JSON
    }
  });

  const send = (s: string) => proc.stdin!.write(s + "\n");

  // 1. initialize
  send(rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } }));
  send(notify("notifications/initialized", {}));

  // Wait for discovery to finish
  await new Promise((r) => setTimeout(r, 4000));

  // 2. tools/list
  send(rpc("tools/list", {}, 2));

  // 3. search_tools — fuzzy
  send(rpc("tools/call", { name: "search_tools", arguments: { query: "погода" } }, 3));

  // 4. search_tools — finds external
  send(rpc("tools/call", { name: "search_tools", arguments: { query: "metatools" } }, 4));

  // 5. run_tool — internal
  send(rpc("tools/call", { name: "run_tool", arguments: { tool_name: "add", arguments: { a: 10, b: 20 } } }, 5));

  // 6. run_tool — external call to Python server's search_tools
  send(rpc("tools/call", { name: "run_tool", arguments: { tool_name: "metatools-pro::search_tools", arguments: { query: "password" } } }, 6));

  // Wait for responses
  await new Promise((r) => setTimeout(r, 2000));
  proc.kill();

  // Deduplicate by id
  const byId = new Map<number, any>();
  for (const r of responses) {
    if (r.id && !byId.has(r.id)) byId.set(r.id, r);
  }

  console.log("=".repeat(60));
  console.log(`Ответов: ${byId.size}`);
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  for (const [id, r] of [...byId].sort((a, b) => a[0] - b[0])) {
    console.log(`\n[${id}]`);

    if (r.result?.tools) {
      const tools = r.result.tools;
      console.log(`  tools/list: ${tools.length} tools`);
      for (const t of tools) {
        console.log(`    • ${t.name}`);
      }
      if (tools.length === 2) { passed++; console.log("  ✓"); }
      else { failed++; console.log(`  ✗ expected 2, got ${tools.length}`); }
    } else if (r.result?.content) {
      const text = r.result.content[0]?.text;
      if (!text) { failed++; console.log("  ✗ no content"); continue; }
      const parsed = JSON.parse(text);

      if (Array.isArray(parsed)) {
        console.log(`  search: ${parsed.length} hits`);
        for (const h of parsed.slice(0, 5)) {
          console.log(`    • ${h.tool.name}`);
        }
        if (parsed.length > 0) { passed++; console.log("  ✓"); }
        else { failed++; console.log("  ✗ no hits"); }
      } else {
        console.log(`  run: status=${parsed.status}`);
        if (parsed.status === "success") { passed++; console.log("  ✓"); }
        else { failed++; console.log(`  ✗ ${parsed.error}`); }
      }
    } else if (r.result?.protocolVersion) {
      console.log(`  initialize: v${r.result.protocolVersion}`);
      passed++;
      console.log("  ✓");
    } else if (r.error) {
      console.log(`  ERROR: ${r.error.message}`);
      failed++;
      console.log("  ✗");
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});

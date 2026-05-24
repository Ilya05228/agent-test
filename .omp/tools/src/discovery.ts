/**
 * MCP Discovery — connects to external MCP servers from mcp.json,
 * lists their tools, and proxies tool calls.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Types ──────────────────────────────────────────────────

export interface McpServerConfig {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  servers?: Record<string, McpServerConfig>;
}

interface GatewayConfig {
  gateway?: { servers?: Record<string, McpServerConfig> };
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ExternalTool {
  /** Qualified name: "server::tool" */
  qualifiedName: string;
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface StdioConnection {
  kind: "stdio";
  client: Client;
  transport: StdioClientTransport;
}

interface HttpConnection {
  kind: "http";
  url: string;
  headers: Record<string, string>;
}

type Connection = StdioConnection | HttpConnection;

// ── JSON-RPC helpers ───────────────────────────────────────

function rpc(id: number, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** Resolve ${env:VAR} and ${VAR} patterns in a string */
function resolveEnvVars(s: string): string {
  return s.replace(/\$\{(?:env:)?(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

/** Resolve env vars in all values of a record */
function resolveEnvInRecord(rec: Record<string, string> | undefined): Record<string, string> {
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = resolveEnvVars(v);
  }
  return out;
}

// ── HTTP JSON-RPC client ───────────────────────────────────

async function httpJsonRpc(
  url: string,
  headers: Record<string, string>,
  method: string,
  params?: unknown,
): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: rpc(1, method, params),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${url}`);
  }
  const data = (await resp.json()) as any;
  if (data.error) {
    throw new Error(`JSON-RPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

// ── Discovery class ────────────────────────────────────────

export class McpDiscovery {
  private connections = new Map<string, Connection>();

  /** Load mcp.json and discover tools from all reachable servers */
  async discoverFromConfig(configPath: string, skipServers: string[] = []): Promise<ExternalTool[]> {
    const raw = readFileSync(configPath, "utf-8");
    let config: GatewayConfig;
    try {
      config = JSON.parse(raw) as GatewayConfig;
    } catch {
      console.error(`[discovery] Failed to parse ${configPath}`);
      return [];
    }

    const servers = config.mcpServers?.["metatools-pro-ts"]?.servers ?? config.gateway?.servers ?? config.mcpServers ?? {};
    const allTools: ExternalTool[] = [];

    for (const [serverName, serverCfg] of Object.entries(servers)) {
      if (skipServers.includes(serverName)) {
        console.error(`[discovery] ${serverName}: SKIP — self`);
        continue;
      }
      try {
        const tools = await this._discoverOne(serverName, serverCfg);
        allTools.push(...tools);
        console.error(`[discovery] ${serverName}: ${tools.length} tools`);
      } catch (e: any) {
        console.error(`[discovery] ${serverName}: SKIP — ${e.message}`);
      }
    }

    return allTools;
  }

  /** Call a tool on an external server */
  async callExternalTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`Server "${serverName}" not connected`);
    }

    if (conn.kind === "stdio") {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });
      return result.content;
    } else {
      return httpJsonRpc(conn.url, conn.headers, "tools/call", {
        name: toolName,
        arguments: args,
      });
    }
  }

  /** Shutdown all connections */
  async shutdown(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        if (conn.kind === "stdio") {
          await conn.transport.close();
        }
      } catch {
        // best-effort
      }
    }
    this.connections.clear();
  }

  // ── Private ──────────────────────────────────────────

  private async _discoverOne(
    name: string,
    cfg: McpServerConfig,
  ): Promise<ExternalTool[]> {
    if (cfg.url && !cfg.command) {
      return this._discoverHttp(name, cfg);
    }
    return this._discoverStdio(name, cfg);
  }

  private async _discoverStdio(
    name: string,
    cfg: McpServerConfig,
  ): Promise<ExternalTool[]> {
    const command = cfg.command!;
    const args = cfg.args ?? [];
    const env = resolveEnvInRecord(cfg.env);

    const transport = new StdioClientTransport({
      command,
      args,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(
          (kv): kv is [string, string] => kv[1] !== undefined,
        ),
      ),
      stderr: "pipe",
    });

    // Pipe stderr to parent for debugging
    transport.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[${name}] ${chunk}`);
    });

    const client = new Client(
      { name: "metatools-gateway", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.connections.set(name, { kind: "stdio", client, transport });

    const result = await client.listTools();
    return (result.tools ?? []).map((t: any) => ({
      qualifiedName: `${name}::${t.name}`,
      serverName: name,
      toolName: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? {},
    }));
  }

  private async _discoverHttp(
    name: string,
    cfg: McpServerConfig,
  ): Promise<ExternalTool[]> {
    const url = cfg.url!;
    const headers = resolveEnvInRecord(cfg.headers);

    // Initialize
    await httpJsonRpc(url, headers, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "metatools-gateway", version: "1.0.0" },
    });
    // Send initialized notification
    await httpJsonRpc(url, headers, "notifications/initialized", {});

    this.connections.set(name, { kind: "http", url, headers });

    const result = await httpJsonRpc(url, headers, "tools/list");
    return ((result.tools ?? result) as any[] ?? []).map((t: any) => ({
      qualifiedName: `${name}::${t.name}`,
      serverName: name,
      toolName: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? {},
    }));
  }
}

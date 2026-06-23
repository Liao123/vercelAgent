import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpConfigFile, McpServerConfigEntry } from "@/agent/mcp/types";

export function isMcpIntegrationEnabled(): boolean {
  const flag = process.env.AGENT_MCP_ENABLED?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return resolveMcpConfigPath() != null || Boolean(process.env.AGENT_MCP_SERVERS?.trim());
}

function parseConfigJson(raw: string, source: string): McpConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid MCP config JSON: ${source}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`MCP config must be an object: ${source}`);
  }
  return parsed as McpConfigFile;
}

function tryReadConfigFile(filePath: string): McpConfigFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseConfigJson(fs.readFileSync(filePath, "utf8"), filePath);
  } catch {
    return null;
  }
}

/** 与 Cursor `mcp.json` 相同的路径搜索顺序 */
export function resolveMcpConfigPath(): string | null {
  const explicit = process.env.AGENT_MCP_CONFIG?.trim();
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit);

  const candidates = [
    path.join(process.cwd(), "mcp.json"),
    path.join(process.cwd(), ".cursor", "mcp.json"),
    path.join(os.homedir(), ".cursor", "mcp.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadMcpConfig(): {
  configPath: string | null;
  servers: Record<string, McpServerConfigEntry>;
} {
  const envRaw = process.env.AGENT_MCP_SERVERS?.trim();
  if (envRaw) {
    const parsed = parseConfigJson(envRaw, "AGENT_MCP_SERVERS");
    return {
      configPath: null,
      servers: parsed.mcpServers ?? {},
    };
  }

  const configPath = resolveMcpConfigPath();
  if (!configPath) {
    return { configPath: null, servers: {} };
  }

  const config = tryReadConfigFile(configPath);
  return {
    configPath,
    servers: config?.mcpServers ?? {},
  };
}

export function listEnabledMcpServers(
  servers: Record<string, McpServerConfigEntry>,
): Array<{ id: string; entry: McpServerConfigEntry }> {
  return Object.entries(servers)
    .filter(([, entry]) => !entry.disabled)
    .map(([id, entry]) => ({ id, entry }));
}

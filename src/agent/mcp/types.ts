/** Cursor / Claude Desktop 兼容的 MCP 服务器配置项 */
export type McpServerConfigEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Streamable HTTP / SSE 远程 MCP */
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
};

export type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfigEntry>;
};

export type McpServerStatus = {
  id: string;
  connected: boolean;
  transport: "stdio" | "http" | "sse";
  toolCount: number;
  error?: string;
};

export type McpToolBinding = {
  serverId: string;
  toolName: string;
};

export type McpRegistrySnapshot = {
  enabled: boolean;
  configPath: string | null;
  servers: McpServerStatus[];
  tools: Array<{
    internalName: string;
    apiName: string;
    serverId: string;
    toolName: string;
    description: string;
  }>;
};

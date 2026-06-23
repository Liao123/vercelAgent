import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ModelToolDefinition } from "@/agent/model/types";
import {
  isMcpIntegrationEnabled,
  listEnabledMcpServers,
  loadMcpConfig,
} from "@/agent/mcp/config";
import {
  encodeMcpInternalName,
  mcpApiNameFromInternal,
} from "@/agent/mcp/tool-names";
import type {
  McpRegistrySnapshot,
  McpServerConfigEntry,
  McpServerStatus,
  McpToolBinding,
} from "@/agent/mcp/types";

type ConnectedServer = {
  id: string;
  client: Client;
  transport: "stdio" | "http" | "sse";
  tools: Tool[];
  error?: string;
};

const CLIENT_INFO = { name: "vec-next-agent", version: "0.1.0" };

class McpRegistry {
  private ready = false;
  private loading: Promise<void> | null = null;
  private configPath: string | null = null;
  private servers = new Map<string, ConnectedServer>();
  private internalToBinding = new Map<string, McpToolBinding>();
  private apiToInternal = new Map<string, string>();
  private toolDefinitions: ModelToolDefinition[] = [];

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (this.loading) {
      await this.loading;
      return;
    }
    this.loading = this.bootstrap();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async bootstrap(): Promise<void> {
    this.servers.clear();
    this.internalToBinding.clear();
    this.apiToInternal.clear();
    this.toolDefinitions = [];

    if (!isMcpIntegrationEnabled()) {
      this.ready = true;
      return;
    }

    const { configPath, servers } = loadMcpConfig();
    this.configPath = configPath;
    const enabled = listEnabledMcpServers(servers);

    for (const { id, entry } of enabled) {
      await this.connectServer(id, entry);
    }

    this.rebuildToolIndex();
    this.ready = true;
  }

  private async connectServer(
    id: string,
    entry: McpServerConfigEntry,
  ): Promise<void> {
    const client = new Client(CLIENT_INFO);
    const timeoutMs = Math.max(
      5_000,
      Number.parseInt(process.env.AGENT_MCP_CONNECT_TIMEOUT_MS ?? "25000", 10) ||
        25_000,
    );
    try {
      const transportKind = this.createTransport(entry);
      await Promise.race([
        client.connect(transportKind.transport),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`MCP connect timeout (${timeoutMs}ms)`)),
            timeoutMs,
          );
        }),
      ]);
      const tools = await this.listAllTools(client);
      this.servers.set(id, {
        id,
        client,
        transport: transportKind.kind,
        tools,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "MCP connect failed";
      this.servers.set(id, {
        id,
        client,
        transport: entry.url ? "http" : "stdio",
        tools: [],
        error: message,
      });
    }
  }

  private createTransport(entry: McpServerConfigEntry): {
    kind: ConnectedServer["transport"];
    transport: Transport;
  } {
    if (entry.url?.trim()) {
      const url = new URL(entry.url.trim());
      if (url.pathname.endsWith("/sse") || entry.url.includes("/sse")) {
        return {
          kind: "sse",
          transport: new SSEClientTransport(url, {
            requestInit: entry.headers
              ? { headers: entry.headers }
              : undefined,
          }),
        };
      }
      return {
        kind: "http",
        transport: new StreamableHTTPClientTransport(url, {
          requestInit: entry.headers
            ? { headers: entry.headers }
            : undefined,
        }),
      };
    }

    if (!entry.command?.trim()) {
      throw new Error("MCP server requires command or url");
    }

    return {
      kind: "stdio",
      transport: new StdioClientTransport({
        command: entry.command.trim(),
        args: entry.args ?? [],
        env: entry.env,
        cwd: entry.cwd,
        stderr: "pipe",
      }),
    };
  }

  private async listAllTools(client: Client): Promise<Tool[]> {
    const all: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      all.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  }

  private rebuildToolIndex(): void {
    this.internalToBinding.clear();
    this.apiToInternal.clear();
    this.toolDefinitions = [];

    for (const server of this.servers.values()) {
      if (server.error || server.tools.length === 0) continue;
      for (const tool of server.tools) {
        const internalName = encodeMcpInternalName(server.id, tool.name);
        const apiName = mcpApiNameFromInternal(internalName);
        this.internalToBinding.set(internalName, {
          serverId: server.id,
          toolName: tool.name,
        });
        this.apiToInternal.set(apiName, internalName);
        this.toolDefinitions.push({
          type: "function",
          function: {
            name: apiName,
            description: `[MCP · ${server.id}] ${tool.description ?? tool.name}`,
            parameters: normalizeMcpInputSchema(tool.inputSchema),
          },
        });
      }
    }
  }

  getToolDefinitions(): ModelToolDefinition[] {
    return this.toolDefinitions;
  }

  decodeApiToolName(apiName: string): string | null {
    return this.apiToInternal.get(apiName) ?? null;
  }

  resolveBinding(internalName: string): McpToolBinding | null {
    return this.internalToBinding.get(internalName) ?? null;
  }

  async callTool(
    binding: McpToolBinding,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureReady();
    const server = this.servers.get(binding.serverId);
    if (!server) {
      throw new Error(`MCP server not connected: ${binding.serverId}`);
    }
    if (server.error) {
      throw new Error(`MCP server ${binding.serverId}: ${server.error}`);
    }

    const result = await server.client.callTool({
      name: binding.toolName,
      arguments: args,
    });

    if (result.isError) {
      return {
        error: true,
        content: result.content,
        structuredContent: result.structuredContent,
      };
    }

    if (result.structuredContent != null) {
      return result.structuredContent;
    }

    const content = Array.isArray(result.content) ? result.content : [];
    const textParts = content
      .filter(
        (item): item is { type: "text"; text: string } =>
          typeof item === "object" &&
          item != null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string",
      )
      .map((item) => item.text);
    if (textParts.length === 1) return textParts[0];
    if (textParts.length > 1) return textParts.join("\n");
    return content.length > 0 ? content : result;
  }

  getSnapshot(): McpRegistrySnapshot {
    const servers: McpServerStatus[] = [];
    for (const server of this.servers.values()) {
      servers.push({
        id: server.id,
        connected: !server.error,
        transport: server.transport,
        toolCount: server.tools.length,
        error: server.error,
      });
    }

    const tools = [...this.internalToBinding.entries()].map(
      ([internalName, binding]) => ({
        internalName,
        apiName: mcpApiNameFromInternal(internalName),
        serverId: binding.serverId,
        toolName: binding.toolName,
        description:
          serverToolDescription(this.servers, binding) ?? binding.toolName,
      }),
    );

    return {
      enabled: isMcpIntegrationEnabled(),
      configPath: this.configPath,
      servers,
      tools,
    };
  }

  async close(): Promise<void> {
    for (const server of this.servers.values()) {
      try {
        await server.client.close();
      } catch {
        // ignore shutdown errors
      }
    }
    this.servers.clear();
    this.internalToBinding.clear();
    this.apiToInternal.clear();
    this.toolDefinitions = [];
    this.ready = false;
  }
}

function serverToolDescription(
  servers: Map<string, ConnectedServer>,
  binding: McpToolBinding,
): string | undefined {
  const server = servers.get(binding.serverId);
  return server?.tools.find((tool) => tool.name === binding.toolName)
    ?.description;
}

function normalizeMcpInputSchema(
  schema: Tool["inputSchema"] | undefined,
): Record<string, unknown> {
  if (schema && typeof schema === "object") {
    return schema as Record<string, unknown>;
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

const globalRegistry = new McpRegistry();

export async function ensureMcpRegistryReady(): Promise<void> {
  if (!isMcpIntegrationEnabled()) return;
  await globalRegistry.ensureReady();
}

export function getMcpToolDefinitions(): ModelToolDefinition[] {
  return globalRegistry.getToolDefinitions();
}

export function decodeMcpApiToolName(apiName: string): string | null {
  return globalRegistry.decodeApiToolName(apiName);
}

export function resolveMcpToolBinding(
  internalName: string,
): McpToolBinding | null {
  return globalRegistry.resolveBinding(internalName);
}

export async function callMcpTool(
  binding: McpToolBinding,
  args: Record<string, unknown>,
): Promise<unknown> {
  return globalRegistry.callTool(binding, args);
}

export function getMcpRegistrySnapshot(): McpRegistrySnapshot {
  return globalRegistry.getSnapshot();
}

export async function resetMcpRegistry(): Promise<void> {
  await globalRegistry.close();
}

/** 测试 / 热重载：强制重新连接所有 MCP 服务器 */
export async function reloadMcpRegistry(): Promise<McpRegistrySnapshot> {
  await globalRegistry.close();
  await globalRegistry.ensureReady();
  return globalRegistry.getSnapshot();
}

/**
 * Next.js 侧 MCP 远程代理：当设置 AGENT_SERVER_URL 时，工具发现/调用走长驻 agent-server。
 */
import type { ModelToolDefinition } from "@/agent/model/types";
import { resolveAgentServerUrl } from "@/agent-server/config";
import type { McpRegistrySnapshot, McpToolBinding } from "@/agent/mcp/types";

type RemoteCache = {
  snapshot: McpRegistrySnapshot;
  toolDefinitions: ModelToolDefinition[];
  apiToInternal: Map<string, string>;
  internalToBinding: Map<string, McpToolBinding>;
};

let cache: RemoteCache | null = null;

function baseUrl(): string {
  const url = resolveAgentServerUrl();
  if (!url) throw new Error("AGENT_SERVER_URL is not set");
  return url;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof body === "object" && body && "error" in body && body.error
        ? String(body.error)
        : `agent-server ${path} failed (${res.status})`,
    );
  }
  return body;
}

function rebuildMaps(snapshot: McpRegistrySnapshot): RemoteCache {
  const apiToInternal = new Map<string, string>();
  const internalToBinding = new Map<string, McpToolBinding>();
  for (const tool of snapshot.tools) {
    apiToInternal.set(tool.apiName, tool.internalName);
    internalToBinding.set(tool.internalName, {
      serverId: tool.serverId,
      toolName: tool.toolName,
    });
  }
  return {
    snapshot,
    toolDefinitions: [],
    apiToInternal,
    internalToBinding,
  };
}

async function refreshCache(): Promise<RemoteCache> {
  const snapshot = await fetchJson<McpRegistrySnapshot>("/mcp");
  const toolsPayload = await fetchJson<{ tools: ModelToolDefinition[] }>(
    "/mcp/tools",
  );
  const next = rebuildMaps(snapshot);
  next.toolDefinitions = toolsPayload.tools;
  cache = next;
  return next;
}

export async function remoteEnsureMcpReady(): Promise<void> {
  await fetchJson("/health");
  await refreshCache();
}

export function remoteGetMcpToolDefinitions(): ModelToolDefinition[] {
  return cache?.toolDefinitions ?? [];
}

export function remoteDecodeMcpApiToolName(apiName: string): string | null {
  return cache?.apiToInternal.get(apiName) ?? null;
}

export function remoteResolveMcpToolBinding(
  internalName: string,
): McpToolBinding | null {
  return cache?.internalToBinding.get(internalName) ?? null;
}

export async function remoteCallMcpTool(
  binding: McpToolBinding,
  args: Record<string, unknown>,
): Promise<unknown> {
  const internalName = [...(cache?.internalToBinding.entries() ?? [])].find(
    ([, value]) =>
      value.serverId === binding.serverId &&
      value.toolName === binding.toolName,
  )?.[0];
  if (!internalName) {
    await refreshCache();
  }
  const resolved =
    [...(cache?.internalToBinding.entries() ?? [])].find(
      ([, value]) =>
        value.serverId === binding.serverId &&
        value.toolName === binding.toolName,
    )?.[0] ?? null;
  if (!resolved) {
    throw new Error(
      `MCP binding not found: ${binding.serverId}.${binding.toolName}`,
    );
  }
  const payload = await fetchJson<{ ok: boolean; result: unknown }>(
    "/mcp/call",
    {
      method: "POST",
      body: JSON.stringify({ internalName: resolved, args }),
    },
  );
  return payload.result;
}

export function remoteGetMcpRegistrySnapshot(): McpRegistrySnapshot {
  if (!cache) {
    return {
      enabled: true,
      configPath: null,
      servers: [],
      tools: [],
    };
  }
  return cache.snapshot;
}

export async function remoteReloadMcpRegistry(): Promise<McpRegistrySnapshot> {
  const payload = await fetchJson<McpRegistrySnapshot & { ok?: boolean }>(
    "/mcp/reload",
    { method: "POST", body: "{}" },
  );
  await refreshCache();
  return cache?.snapshot ?? payload;
}

export async function remoteResetMcpRegistry(): Promise<void> {
  cache = null;
}

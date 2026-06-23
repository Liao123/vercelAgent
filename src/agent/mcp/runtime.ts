/**
 * MCP 运行时门面：本地 registry 或远程 agent-server。
 */
import {
  isAgentServerHosting,
  resolveAgentServerUrl,
} from "@/agent-server/config";
import type { ModelToolDefinition } from "@/agent/model/types";
import type { McpRegistrySnapshot, McpToolBinding } from "@/agent/mcp/types";
import * as local from "@/agent/mcp/registry";
import * as remote from "@/agent/mcp/remote-client";

function useRemoteAgentServer(): boolean {
  if (isAgentServerHosting()) return false;
  return Boolean(resolveAgentServerUrl());
}

export async function ensureMcpRegistryReady(): Promise<void> {
  if (!useRemoteAgentServer()) {
    return local.ensureMcpRegistryReady();
  }
  return remote.remoteEnsureMcpReady();
}

export function getMcpToolDefinitions(): ModelToolDefinition[] {
  return useRemoteAgentServer()
    ? remote.remoteGetMcpToolDefinitions()
    : local.getMcpToolDefinitions();
}

export function decodeMcpApiToolName(apiName: string): string | null {
  return useRemoteAgentServer()
    ? remote.remoteDecodeMcpApiToolName(apiName)
    : local.decodeMcpApiToolName(apiName);
}

export function resolveMcpToolBinding(
  internalName: string,
): McpToolBinding | null {
  return useRemoteAgentServer()
    ? remote.remoteResolveMcpToolBinding(internalName)
    : local.resolveMcpToolBinding(internalName);
}

export async function callMcpTool(
  binding: McpToolBinding,
  args: Record<string, unknown>,
): Promise<unknown> {
  return useRemoteAgentServer()
    ? remote.remoteCallMcpTool(binding, args)
    : local.callMcpTool(binding, args);
}

export function getMcpRegistrySnapshot(): McpRegistrySnapshot {
  return useRemoteAgentServer()
    ? remote.remoteGetMcpRegistrySnapshot()
    : local.getMcpRegistrySnapshot();
}

export async function resetMcpRegistry(): Promise<void> {
  if (useRemoteAgentServer()) {
    await remote.remoteResetMcpRegistry();
    return;
  }
  return local.resetMcpRegistry();
}

export async function reloadMcpRegistry(): Promise<McpRegistrySnapshot> {
  if (useRemoteAgentServer()) {
    return remote.remoteReloadMcpRegistry();
  }
  return local.reloadMcpRegistry();
}

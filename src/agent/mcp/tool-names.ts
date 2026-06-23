const MCP_INTERNAL_PREFIX = "mcp.";

/** 内部名：`mcp.chrome-devtools.click` */
export function encodeMcpInternalName(serverId: string, toolName: string): string {
  return `${MCP_INTERNAL_PREFIX}${serverId}.${toolName}`;
}

export function isMcpInternalToolName(name: string): boolean {
  return name.startsWith(MCP_INTERNAL_PREFIX);
}

export function parseMcpInternalToolName(
  internalName: string,
): { serverId: string; toolName: string } | null {
  if (!isMcpInternalToolName(internalName)) return null;
  const rest = internalName.slice(MCP_INTERNAL_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot >= rest.length - 1) return null;
  return {
    serverId: rest.slice(0, dot),
    toolName: rest.slice(dot + 1),
  };
}

/** OpenAI API 名（与 encodeOpenAiToolName 规则一致） */
export function mcpApiNameFromInternal(internalName: string): string {
  return internalName.replace(/\./g, "_");
}

export function mcpInternalNameFromParts(
  serverId: string,
  toolName: string,
): string {
  return encodeMcpInternalName(serverId, toolName);
}

import type { McpRegistrySnapshot } from "@/agent/mcp/types";

const MAX_LISTED_TOOLS = 36;

/**
 * 注入 Loop 系统 prompt：已连接 MCP 服务器摘要 + 浏览器优先策略。
 */
export function formatMcpToolsForPrompt(
  snapshot: McpRegistrySnapshot | null | undefined,
): string {
  if (!snapshot?.enabled) return "";

  const connected = snapshot.servers.filter((server) => server.connected);
  const failed = snapshot.servers.filter((server) => !server.connected);

  if (connected.length === 0) {
    if (failed.length === 0) return "";
    return [
      "**MCP status:** configured but not connected.",
      ...failed.map(
        (server) =>
          `- \`${server.id}\`: ${server.error ?? "connection failed"}`,
      ),
      "- **Do not stop.** Use built-in `browser.*` / `devtools.*` or call `agent.diagnose`.",
      "- Screenshot to disk: `devtools.get_screenshot` with `filePath` `desktop:name.jpg`.",
    ].join("\n");
  }

  const browserServers = connected.filter((server) =>
    /chrome|devtools|browser/i.test(server.id),
  );
  const hasBrowserMcp = browserServers.length > 0;

  const lines: string[] = [
    "**MCP external tools (market-standard, connected):**",
    ...connected.map(
      (server) =>
        `- Server \`${server.id}\` — ${server.toolCount} tools via ${server.transport}`,
    ),
  ];

  if (hasBrowserMcp) {
    lines.push(
      "- **Browser / DevTools: prefer MCP over built-in `browser.*` / `devtools.*`** when `mcp.{server}.{tool}` appears in your tool list (e.g. `mcp.chrome-devtools.navigate_page`).",
      "  Typical flow: `list_pages` → `navigate_page` ({type:\"url\",url}) → `take_snapshot` or `take_screenshot` → optional `performance_start_trace` / `list_network_requests`.",
      "  To save to disk: `take_screenshot` with `filePath` (`~/Desktop/…`, `desktop:name.png`, or absolute path).",
      "  Use built-in `browser.*` / `devtools.*` only if MCP tools are missing or return connection errors.",
    );
  } else {
    lines.push(
      "- For domain-specific tasks, prefer `mcp.{server}.{tool}` when listed below over reimplementing with shell/file tools.",
    );
  }

  const toolSample = snapshot.tools
    .slice(0, MAX_LISTED_TOOLS)
    .map((tool) => tool.internalName);
  if (toolSample.length > 0) {
    lines.push(`- Available MCP tools (sample): ${toolSample.join(", ")}`);
    if (snapshot.tools.length > MAX_LISTED_TOOLS) {
      lines.push(
        `  … +${snapshot.tools.length - MAX_LISTED_TOOLS} more (see tool schema descriptions prefixed with [MCP · serverId]).`,
      );
    }
  }

  return lines.join("\n");
}

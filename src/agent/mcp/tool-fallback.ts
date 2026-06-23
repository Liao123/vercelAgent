/** MCP 浏览器工具 → 内置工具 fallback 提示（任务内自救）。 */
const CHROME_DEVTOOLS_FALLBACK: Record<string, string> = {
  take_screenshot: "devtools.get_screenshot",
  take_snapshot: "browser.inspect",
  navigate_page: "browser.open",
  new_page: "devtools.new_page",
  list_pages: "devtools.list_pages",
  select_page: "devtools.switch_page",
  click: "devtools.click",
  type_text: "devtools.type",
  fill: "devtools.type",
  list_network_requests: "devtools.get_network_requests",
  list_console_messages: "devtools.get_console_errors",
  performance_start_trace: "devtools.performance_start_trace",
  performance_stop_trace: "devtools.performance_stop_trace",
};

export function suggestMcpToolFallback(
  serverId: string,
  toolName: string,
): { useInstead: string; hint: string } | null {
  if (!/chrome|devtools|browser/i.test(serverId)) return null;
  const builtin = CHROME_DEVTOOLS_FALLBACK[toolName];
  if (builtin) {
    return {
      useInstead: builtin,
      hint: `MCP \`${serverId}.${toolName}\` 不可用，请立即改用内置 \`${builtin}\` 并继续任务；仍失败则调用 agent.diagnose。`,
    };
  }
  return {
    useInstead: "browser.inspect",
    hint: "MCP 浏览器工具失败，请改用内置 browser.* / devtools.* 并调用 agent.diagnose 查看状态。",
  };
}

export function suggestMcpToolNotFound(internalName: string): {
  error: string;
  hint: string;
  useInstead?: string;
} {
  const parsed = internalName.replace(/^mcp\./, "").split(".");
  const toolName = parsed.pop() ?? "";
  const serverId = parsed.join(".");
  const fallback = serverId
    ? suggestMcpToolFallback(serverId, toolName)
    : null;
  return {
    error: `MCP tool not found: ${internalName}`,
    hint:
      fallback?.hint ??
      "MCP 未连接或工具未注册。请调用 agent.diagnose，并改用内置 browser.* / devtools.*。",
    useInstead: fallback?.useInstead,
  };
}

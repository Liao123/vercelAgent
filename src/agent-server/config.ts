const DEFAULT_PORT = 3920;

export function resolveAgentServerPort(): number {
  const raw = process.env.AGENT_SERVER_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_PORT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function resolveAgentServerUrl(): string | null {
  const raw = process.env.AGENT_SERVER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function defaultAgentServerListenHost(): string {
  const raw = process.env.AGENT_SERVER_HOST?.trim();
  return raw || "127.0.0.1";
}

/** agent-server 进程内为 true，避免 MCP/Loop 再代理回自己。 */
export function isAgentServerHosting(): boolean {
  return process.env.AGENT_SERVER_HOSTING === "1";
}

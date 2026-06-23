import { resolveAgentServerUrl } from "@/agent-server/config";
import { isRemoteLoopEnabled } from "@/agent-server/remote-loop";

/** Trace 与 Loop 同进程写入；远程 Loop 时 trace 在 agent-server。 */
export function isRemoteTraceEnabled(): boolean {
  return isRemoteLoopEnabled();
}

function baseUrl(): string {
  const url = resolveAgentServerUrl();
  if (!url) throw new Error("AGENT_SERVER_URL is not configured.");
  return url;
}

export async function proxyTraceGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const upstream = await fetch(`${baseUrl()}/trace${url.search}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const body = await upstream.json().catch(() => ({
    error: `agent-server /trace failed (${upstream.status})`,
  }));
  return Response.json(body, { status: upstream.status });
}

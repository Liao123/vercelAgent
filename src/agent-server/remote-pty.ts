import { resolveAgentServerUrl } from "@/agent-server/config";
import { SSE_HEADERS } from "@/agent-server/sse";

export function isRemotePtyEnabled(): boolean {
  if (process.env.AGENT_PTY_REMOTE === "0") return false;
  return Boolean(resolveAgentServerUrl());
}

function baseUrl(): string {
  const url = resolveAgentServerUrl();
  if (!url) throw new Error("AGENT_SERVER_URL is not configured.");
  return url;
}

export async function proxyPtyGet(): Promise<Response> {
  const res = await fetch(`${baseUrl()}/pty`, {
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json();
  return Response.json(body, { status: res.status });
}

export async function proxyPtyPost(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await fetch(`${baseUrl()}/pty`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: request.signal,
  });
  const payload = await res.json();
  return Response.json(payload, { status: res.status });
}

export async function proxyPtyStream(
  request: Request,
  sessionId: string,
): Promise<Response> {
  const upstream = await fetch(
    `${baseUrl()}/pty/${encodeURIComponent(sessionId)}/stream`,
    { signal: request.signal },
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: text || `agent-server PTY stream failed (${upstream.status})` },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  return new Response(upstream.body, { headers: { ...SSE_HEADERS } });
}

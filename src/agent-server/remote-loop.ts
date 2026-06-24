import { resolveAgentServerUrl } from "@/agent-server/config";
import type { AgentGuidanceRequestBody } from "@/agent/protocol/guidance-request";
import type { AgentLoopRequestBody } from "@/agent/protocol/loop-request";
import { SSE_HEADERS } from "@/agent-server/sse";

export function isRemoteLoopEnabled(): boolean {
  if (process.env.AGENT_LOOP_REMOTE === "0") return false;
  return Boolean(resolveAgentServerUrl());
}

export async function proxyAgentLoopToServer(
  request: Request,
  body: AgentLoopRequestBody,
): Promise<Response> {
  const baseUrl = resolveAgentServerUrl();
  if (!baseUrl) {
    return Response.json(
      { error: "AGENT_SERVER_URL is not configured." },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${baseUrl}/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      {
        error:
          text ||
          `agent-server /loop failed (${upstream.status})`,
      },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      ...SSE_HEADERS,
    },
  });
}

export async function proxyAgentGuidanceToServer(
  request: Request,
  body: AgentGuidanceRequestBody,
): Promise<Response> {
  const baseUrl = resolveAgentServerUrl();
  if (!baseUrl) {
    return Response.json(
      { error: "AGENT_SERVER_URL is not configured." },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${baseUrl}/guidance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  const text = await upstream.text().catch(() => "");
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { error: text };
    }
  }

  return Response.json(payload, {
    status: upstream.status >= 400 ? upstream.status : upstream.ok ? 200 : 502,
  });
}

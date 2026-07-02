/**
 * 运行中用户引导（Cursor steering）：向活跃 Loop 队列追加提示。
 * 阶段 B：AGENT_SERVER_URL 时代理到 agent-server。
 */
import {
  GuidanceNotAcceptedError,
  interruptActiveModelForGuidance,
  submitUserGuidance,
} from "@/agent/core/loop-user-guidance";
import {
  isRemoteLoopEnabled,
  proxyAgentGuidanceToServer,
} from "@/agent-server/remote-loop";
import {
  parseAgentGuidanceRequestBody,
  type AgentGuidanceRequestBody,
} from "@/agent/protocol/guidance-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: AgentGuidanceRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (isRemoteLoopEnabled()) {
    return proxyAgentGuidanceToServer(request, body);
  }

  const parsed = parseAgentGuidanceRequestBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const item = submitUserGuidance(parsed.threadId, parsed.text);
    const interrupted = interruptActiveModelForGuidance(parsed.threadId);
    return Response.json({
      ok: true,
      id: item.id,
      at: item.at,
      text: item.text,
      interrupted,
    });
  } catch (error) {
    if (error instanceof GuidanceNotAcceptedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

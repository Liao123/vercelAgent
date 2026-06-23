/**
 * 模型驱动 Agent Loop API。
 *
 * A028：模型按 JSON 协议选择安全工具，runtime 执行后继续把观察结果喂回模型。
 * 阶段 B：设置 AGENT_SERVER_URL 时 Loop SSE 代理到长驻 agent-server。
 */
import { runAgentLoop } from "@/agent/core";
import { isLoopCancelledError } from "@/agent/core/loop-cancel";
import {
  isRemoteLoopEnabled,
  proxyAgentLoopToServer,
} from "@/agent-server/remote-loop";
import { createAgentEventStream } from "@/agent/protocol/stream";
import {
  applyTraceStreamContext,
  emitTaskFailureWithTrace,
  emptyTraceStreamContext,
} from "@/agent/trace/trace-failure";
import {
  parseAgentLoopRequestBody,
  type AgentLoopRequestBody,
} from "@/agent/protocol/loop-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: AgentLoopRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (isRemoteLoopEnabled()) {
    return proxyAgentLoopToServer(request, body);
  }

  const parsed = parseAgentLoopRequestBody(body);
  if (parsed.error) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const writer = createAgentEventStream();
  let traceCtx = emptyTraceStreamContext();

  void runAgentLoop({
    userRequest: parsed.userRequest,
    referenceImages: parsed.referenceImages,
    maxIterations: parsed.maxIterations,
    model: parsed.model,
    threadId: parsed.threadId,
    uiContext: parsed.uiContext,
    attachedPaths: parsed.attachedPaths,
    attachedSelections: parsed.attachedSelections,
    strictPrepare: parsed.strictPrepare,
    shellResume: parsed.shellResume,
    signal: request.signal,
    onEvent: (event) => {
      traceCtx = applyTraceStreamContext(traceCtx, event);
      writer.emit(event);
    },
  })
    .then(() => {
      writer.close();
    })
    .catch((error) => {
      if (isLoopCancelledError(error) || request.signal.aborted) {
        writer.close();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      emitTaskFailureWithTrace((event) => writer.emit(event), {
        taskId: traceCtx.taskId ?? "task_unavailable",
        traceId: traceCtx.traceId,
        error: message,
      });
      writer.close();
    });

  return writer.response;
}

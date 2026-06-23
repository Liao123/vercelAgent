import type { IncomingMessage, ServerResponse } from "node:http";
import { runAgentLoop } from "@/agent/core";
import { isLoopCancelledError } from "@/agent/core/loop-cancel";
import {
  parseAgentLoopRequestBody,
  type AgentLoopRequestBody,
} from "@/agent/protocol/loop-request";
import { beginSseResponse, endSseResponse, writeSseEvent } from "@/agent-server/sse";
import {
  applyTraceStreamContext,
  emitTaskFailureWithTrace,
  emptyTraceStreamContext,
  type TraceStreamContext,
} from "@/agent/trace/trace-failure";
import type { AgentEvent } from "@/agent/types";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function abortSignalFromRequest(req: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  req.on("aborted", () => controller.abort());
  req.on("close", () => {
    if (!req.complete) controller.abort();
  });
  return controller.signal;
}

function sendJsonError(res: ServerResponse, status: number, error: string): void {
  const payload = JSON.stringify({ error });
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function handleAgentLoopPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: AgentLoopRequestBody;
  try {
    body = (await readJsonBody(req)) as AgentLoopRequestBody;
  } catch {
    sendJsonError(res, 400, "Invalid request body.");
    return;
  }

  const parsed = parseAgentLoopRequestBody(body);
  if (parsed.error) {
    sendJsonError(res, 400, parsed.error);
    return;
  }

  const signal = abortSignalFromRequest(req);
  beginSseResponse(res);
  let traceCtx: TraceStreamContext = emptyTraceStreamContext();

  const emitWithContext = (event: AgentEvent) => {
    traceCtx = applyTraceStreamContext(traceCtx, event);
    writeSseEvent(res, event);
  };

  try {
    await runAgentLoop({
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
      signal,
      onEvent: emitWithContext,
    });
  } catch (error) {
    if (!isLoopCancelledError(error) && !signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      emitTaskFailureWithTrace(emitWithContext, {
        taskId: traceCtx.taskId ?? "task_unavailable",
        traceId: traceCtx.traceId,
        error: message,
      });
    }
  } finally {
    endSseResponse(res);
  }
}

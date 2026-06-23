import type { AgentEvent } from "@/agent/types";
import { appendTraceEvent } from "@/agent/trace/trace-store";
import { buildTraceCheckpointEvent } from "@/agent/trace/trace-checkpoint";

export type TraceStreamContext = {
  taskId: string | null;
  traceId: string | null;
};

export function emptyTraceStreamContext(): TraceStreamContext {
  return { taskId: null, traceId: null };
}

export function applyTraceStreamContext(
  ctx: TraceStreamContext,
  event: AgentEvent,
): TraceStreamContext {
  if (event.type === "trace.linked") {
    return { taskId: event.taskId, traceId: event.traceId };
  }
  if (event.type === "task.created") {
    return { ...ctx, taskId: event.taskId };
  }
  return ctx;
}

export function buildTaskFailureEvents(input: {
  taskId: string;
  traceId?: string | null;
  error: string;
}): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (input.traceId) {
    events.push(
      buildTraceCheckpointEvent({
        taskId: input.taskId,
        traceId: input.traceId,
        checkpoint: {
          kind: "task_failed",
          label: "",
          reason: input.error,
        },
      }),
    );
  }
  events.push({
    type: "task.failed",
    taskId: input.taskId,
    error: input.error,
  });
  return events;
}

export function emitTaskFailureWithTrace(
  emit: (event: AgentEvent) => void,
  input: {
    taskId: string;
    traceId?: string | null;
    error: string;
  },
): void {
  for (const event of buildTaskFailureEvents(input)) {
    emit(event);
    if (input.traceId) {
      appendTraceEvent(input.traceId, event);
    }
  }
}

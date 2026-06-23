import type {
  AgentEvent,
  TraceCheckpointKind,
  TraceCheckpointPayload,
} from "@/agent/types";
import { nowIso } from "@/agent/types";

export type { TraceCheckpointKind, TraceCheckpointPayload };

const CHECKPOINT_LABELS: Record<TraceCheckpointKind, string> = {
  task_started: "任务已开始",
  shell_paused: "Shell 等待批准（可续跑）",
  task_completed: "任务已完成",
  task_failed: "任务失败",
  task_cancelled: "任务已取消",
};

export function traceCheckpointLabel(kind: TraceCheckpointKind): string {
  return CHECKPOINT_LABELS[kind];
}

export function buildTraceCheckpointEvent(input: {
  taskId: string;
  traceId: string;
  checkpoint: TraceCheckpointPayload;
  at?: string;
}): Extract<AgentEvent, { type: "trace.checkpoint" }> {
  const label =
    input.checkpoint.label.trim() ||
    traceCheckpointLabel(input.checkpoint.kind);
  return {
    type: "trace.checkpoint",
    taskId: input.taskId,
    traceId: input.traceId,
    at: input.at ?? nowIso(),
    checkpoint: {
      ...input.checkpoint,
      label,
    },
  };
}

export function isResumableTraceCheckpoint(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: "trace.checkpoint" }> {
  return (
    event.type === "trace.checkpoint" &&
    event.checkpoint.resumable === true &&
    event.checkpoint.kind === "shell_paused"
  );
}

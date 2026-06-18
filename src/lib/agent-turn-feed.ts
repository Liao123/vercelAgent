import type { AgentEvent, ApprovalRequest } from "@/agent/types";
import { extractFinalSummaryFromModelText } from "@/lib/parse-agent-final";
import { extractStreamingPreviewFromModelText } from "@/lib/parse-agent-stream";
import {
  collectTurnFileChanges,
  type TurnFileChangeSummary,
} from "@/lib/approval-file-changes";
import { postExecuteVerificationFromTurnEvents } from "@/lib/post-execute-verification";
import type { PostExecuteVerification } from "@/agent/verification";

export type AgentChangeChip = {
  id: string;
  path: string;
  label: string;
  approvalId?: string;
  tone: "pending" | "applied" | "info";
};

export type AgentTurnFeed = {
  taskId: string;
  userRequest: string;
  referenceImages?: string[];
  createdAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  summary?: string;
  error?: string;
  streamingPreview?: string;
  workedEvents: AgentEvent[];
  /** 中间主区域逐步展示的推理/动作（反思 + 工具） */
  narrativeEvents: AgentEvent[];
  /** 折叠区：原始模型 JSON、上下文压缩等 */
  detailEvents: AgentEvent[];
  highlights: AgentEvent[];
  changeChips: AgentChangeChip[];
  fileChanges: TurnFileChangeSummary | null;
  /** 写盘后的 lint/typecheck/build 结果（来自 verification.completed） */
  postExecuteVerification: PostExecuteVerification | null;
  /** 任务剧本（A131） */
  playbook?: {
    id: string;
    title: string;
    goldenSteps: string[];
    softMaxToolRounds: number;
    progressLabel: string;
    completedCount: number;
    totalSteps: number;
    currentStepLabel: string | null;
  };
  workedStats: {
    toolCount: number;
    reflectionCount: number;
    compactCount: number;
    modelOutputCount: number;
  };
};

const WORKED_TYPES = new Set<AgentEvent["type"]>([
  "tool.started",
  "tool.completed",
  "reflection.updated",
  "model.delta",
  "context.compacted",
  "plan.updated",
  "turn.created",
]);

const NARRATIVE_TYPES = new Set<AgentEvent["type"]>([
  "reflection.updated",
  "tool.completed",
  "tool.started",
]);

const DETAIL_TYPES = new Set<AgentEvent["type"]>([
  "model.delta",
  "context.compacted",
]);

const HIGHLIGHT_TYPES = new Set<AgentEvent["type"]>([
  "approval.required",
  "file.changed",
  "verification.completed",
  "task.completed",
  "task.failed",
]);

function chipFromApproval(approval: ApprovalRequest): AgentChangeChip[] {
  const details = approval.details;
  if (!details) {
    return [
      {
        id: approval.id,
        path: approval.title,
        label: "待审批",
        approvalId: approval.id,
        tone: "pending",
      },
    ];
  }

  if (details.kind === "file_mutation") {
    const path =
      details.preview.path ??
      details.preview.toPath ??
      details.preview.fromPath ??
      approval.title;
    const delta = details.preview.sizeDelta;
    const deltaLabel =
      typeof delta === "number"
        ? ` ${delta >= 0 ? "+" : ""}${delta}`
        : "";
    return [
      {
        id: approval.id,
        path,
        label: `待审批${deltaLabel}`,
        approvalId: approval.id,
        tone: "pending",
      },
    ];
  }

  if (details.kind === "patch_apply") {
    return details.preview.files
      .filter((file) => file.changed !== false)
      .slice(0, 6)
      .map((file, index) => ({
        id: `${approval.id}-${index}`,
        path: file.newPath ?? file.oldPath ?? file.filePath ?? approval.title,
        label: "Patch 待审批",
        approvalId: approval.id,
        tone: "pending" as const,
      }));
  }

  return [
    {
      id: approval.id,
      path: approval.title,
      label: "待审批",
      approvalId: approval.id,
      tone: "pending",
    },
  ];
}

function collectChangeChips(events: AgentEvent[]): AgentChangeChip[] {
  const chips: AgentChangeChip[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (event.type === "approval.required") {
      for (const chip of chipFromApproval(event.approval)) {
        const key = `${chip.path}:${chip.approvalId ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chips.push(chip);
      }
    }
    if (event.type === "file.changed") {
      const key = event.filePath;
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push({
        id: `file-${event.filePath}`,
        path: event.filePath,
        label: "已写入",
        tone: "applied",
      });
    }
  }

  return chips;
}

function countWorkedStats(events: AgentEvent[]) {
  return {
    toolCount: events.filter(
      (e) => e.type === "tool.completed" || e.type === "tool.started",
    ).length,
    reflectionCount: events.filter((e) => e.type === "reflection.updated")
      .length,
    compactCount: events.filter((e) => e.type === "context.compacted").length,
    modelOutputCount: events.filter((e) => e.type === "model.delta").length,
  };
}

function resolveTurnSummary(events: AgentEvent[]): {
  summary?: string;
  error?: string;
  streamingPreview?: string;
  status: AgentTurnFeed["status"];
  completedAt?: string;
} {
  const failed = events.find((e) => e.type === "task.failed");
  if (failed) {
    return {
      status: "failed",
      error: failed.error,
      completedAt: failed.task?.updatedAt,
    };
  }

  const completed = events.find((e) => e.type === "task.completed");
  if (completed) {
    return {
      status: "completed",
      summary: completed.summary,
      completedAt: completed.task.completedAt ?? completed.task.updatedAt,
    };
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "model.delta") continue;
    const finalSummary = extractFinalSummaryFromModelText(event.text);
    const streamingPreview =
      extractStreamingPreviewFromModelText(event.text) ?? undefined;
    if (finalSummary) {
      return { status: "running", summary: finalSummary, streamingPreview };
    }
    if (streamingPreview) {
      return { status: "running", streamingPreview };
    }
  }

  return { status: "running" };
}

function extractPlaybookFromEvents(events: AgentEvent[]): AgentTurnFeed["playbook"] | undefined {
  const matched = events.find((e) => e.type === "playbook.matched");
  if (!matched || matched.type !== "playbook.matched") return undefined;
  const progress = events.filter((e) => e.type === "playbook.progress").pop();
  const progressEvent =
    progress && progress.type === "playbook.progress" ? progress : null;
  return {
    id: matched.playbookId,
    title: matched.title,
    goldenSteps: matched.goldenSteps,
    softMaxToolRounds: matched.softMaxToolRounds,
    progressLabel: progressEvent?.progressLabel ?? matched.title,
    completedCount: progressEvent?.completedCount ?? 0,
    totalSteps: progressEvent?.totalSteps ?? matched.goldenSteps.length,
    currentStepLabel: progressEvent?.currentStepLabel ?? null,
  };
}

/** 已完成 tool 不再保留 started，避免中间区重复一行。 */
function filterNarrativeEvents(events: AgentEvent[]): AgentEvent[] {
  const completedToolIds = new Set<string>();
  for (const event of events) {
    if (event.type === "tool.completed") {
      completedToolIds.add(event.toolCall.id);
    }
  }

  const narrative: AgentEvent[] = [];
  for (const event of events) {
    if (event.type === "tool.started" && completedToolIds.has(event.toolCall.id)) {
      continue;
    }
    if (NARRATIVE_TYPES.has(event.type)) {
      narrative.push(event);
    }
  }
  return narrative;
}

function splitTurnEvents(events: AgentEvent[]): {
  worked: AgentEvent[];
  narrative: AgentEvent[];
  detail: AgentEvent[];
  highlights: AgentEvent[];
} {
  const worked: AgentEvent[] = [];
  const narrative = filterNarrativeEvents(events);
  const detail: AgentEvent[] = [];
  const highlights: AgentEvent[] = [];
  const completedToolIds = new Set<string>();
  for (const event of events) {
    if (event.type === "tool.completed") {
      completedToolIds.add(event.toolCall.id);
    }
  }

  for (const event of events) {
    if (HIGHLIGHT_TYPES.has(event.type)) {
      if (event.type === "task.completed" || event.type === "task.failed") {
        continue;
      }
      highlights.push(event);
    } else if (WORKED_TYPES.has(event.type)) {
      if (event.type === "model.delta") {
        const finalSummary = extractFinalSummaryFromModelText(event.text);
        if (finalSummary) continue;
        detail.push(event);
      } else if (DETAIL_TYPES.has(event.type)) {
        detail.push(event);
      } else if (NARRATIVE_TYPES.has(event.type)) {
        if (event.type === "tool.started" && completedToolIds.has(event.toolCall.id)) {
          continue;
        }
        worked.push(event);
      } else {
        worked.push(event);
      }
    }
  }

  return { worked, narrative, detail, highlights };
}

export function groupEventsIntoTurns(events: AgentEvent[]): AgentTurnFeed[] {
  const turns: AgentTurnFeed[] = [];
  let current: {
    taskId: string;
    userRequest: string;
    referenceImages?: string[];
    createdAt: string;
    events: AgentEvent[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    const { worked, narrative, detail, highlights } = splitTurnEvents(current.events);
    const outcome = resolveTurnSummary(current.events);
    turns.push({
      taskId: current.taskId,
      userRequest: current.userRequest,
      referenceImages: current.referenceImages,
      createdAt: current.createdAt,
      completedAt: outcome.completedAt,
      status: outcome.status,
      summary: outcome.summary,
      error: outcome.error,
      streamingPreview: outcome.streamingPreview,
      workedEvents: worked,
      narrativeEvents: narrative,
      detailEvents: detail,
      highlights,
      changeChips: collectChangeChips(current.events),
      fileChanges: collectTurnFileChanges(current.events),
      postExecuteVerification: postExecuteVerificationFromTurnEvents(
        current.events,
      ),
      playbook: extractPlaybookFromEvents(current.events),
      workedStats: countWorkedStats(worked),
    });
    current = null;
  };

  for (const event of events) {
    if (event.type === "task.created") {
      flush();
      current = {
        taskId: event.taskId,
        userRequest: event.task.userRequest,
        referenceImages: event.task.referenceImages,
        createdAt: event.task.createdAt,
        events: [event],
      };
      continue;
    }
    if (current) current.events.push(event);
  }

  flush();
  return turns;
}

export function formatTurnDuration(
  createdAt: string,
  completedAt?: string,
): string | null {
  if (!completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min} 分 ${rem} 秒` : `${min} 分`;
}

export function summarizeWorkedLine(stats: AgentTurnFeed["workedStats"]): string {
  const parts: string[] = [];
  if (stats.toolCount > 0) parts.push(`${stats.toolCount} 步工具`);
  if (stats.reflectionCount > 0) parts.push(`${stats.reflectionCount} 次反思`);
  if (stats.compactCount > 0) parts.push(`${stats.compactCount} 次压缩`);
  if (stats.modelOutputCount > 0) parts.push(`${stats.modelOutputCount} 段模型输出`);
  return parts.length > 0 ? parts.join(" · ") : "无中间步骤";
}

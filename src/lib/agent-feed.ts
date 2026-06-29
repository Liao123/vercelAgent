import type { AgentEvent, AgentPlan, AgentReflection } from "@/agent/types";
import { formatPatchPreviewSummary } from "@/lib/patch-summary";

export function getLatestPlan(events: AgentEvent[]): AgentPlan | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "plan.updated") return event.plan;
  }
  return null;
}

export function getLatestReflection(
  events: AgentEvent[],
): AgentReflection | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "reflection.updated") return event.reflection;
  }
  return null;
}

export type AgentCompactedMemory = {
  summaryId: string;
  method?: "deterministic" | "semantic";
  round?: number;
  contextWindow?: {
    windowNumber: number;
    windowId: string;
    previousWindowId?: string;
  };
  summaryPreview?: string;
  pinnedApprovalCount?: number;
  changedFileCount?: number;
  estimatedTokensBefore?: number;
  estimatedTokensAfter?: number;
  layersApplied?: string[];
};

export function getLatestCompactedMemory(
  events: AgentEvent[],
): AgentCompactedMemory | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "context.compacted") continue;
    return {
      summaryId: event.summaryId,
      method: event.method,
      round: event.round,
      contextWindow: event.contextWindow,
      summaryPreview: event.summaryPreview,
      pinnedApprovalCount: event.pinnedApprovalCount,
      changedFileCount: event.changedFileCount,
      estimatedTokensBefore: event.estimatedTokensBefore,
      estimatedTokensAfter: event.estimatedTokensAfter,
      layersApplied: event.layersApplied,
    };
  }
  return null;
}

export type AgentCompactedMemoryFull = AgentCompactedMemory & {
  memoryContent: string;
  threadId?: string;
};

export function resolveThreadIdFromEvents(events: AgentEvent[]): string | null {
  for (const event of events) {
    if (event.type === "thread.created") return event.threadId;
  }
  for (const event of events) {
    if (event.type === "context.compacted" && event.threadId) {
      return event.threadId;
    }
  }
  return null;
}

export function getLatestCompactedMemoryContent(
  events: AgentEvent[],
): AgentCompactedMemoryFull | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "context.compacted" || !event.memoryContent) continue;
    return {
      summaryId: event.summaryId,
      method: event.method,
      round: event.round,
      contextWindow: event.contextWindow,
      summaryPreview: event.summaryPreview,
      memoryContent: event.memoryContent,
      threadId: event.threadId,
      pinnedApprovalCount: event.pinnedApprovalCount,
      changedFileCount: event.changedFileCount,
      estimatedTokensBefore: event.estimatedTokensBefore,
      estimatedTokensAfter: event.estimatedTokensAfter,
      layersApplied: event.layersApplied,
    };
  }
  return null;
}

export type TouchedFileEntry = {
  path: string;
  label?: string;
};

export function collectTouchedFiles(events: AgentEvent[]): TouchedFileEntry[] {
  const seen = new Set<string>();
  const items: TouchedFileEntry[] = [];

  function add(path: string, label?: string) {
    const normalized = path.replace(/\\/g, "/").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    items.push({ path: normalized, label });
  }

  for (const event of events) {
    if (event.type === "file.changed") {
      add(event.filePath, "已写入");
      continue;
    }
    if (event.type === "approval.required") {
      const details = event.approval.details;
      if (details?.kind === "file_mutation") {
        const preview = details.preview;
        add(
          preview.path ?? preview.toPath ?? preview.fromPath ?? "?",
          "待审批",
        );
      } else if (details?.kind === "patch_apply") {
        for (const file of details.preview.files) {
          if (!file.changed) continue;
          const path = file.newPath ?? file.oldPath ?? file.filePath ?? "?";
          add(path, file.kind ?? "patch");
        }
      }
      continue;
    }
    if (event.type === "tool.completed") {
      const result = event.result;
      if (!result || typeof result !== "object") continue;
      const record = result as Record<string, unknown>;
      if (typeof record.path === "string") {
        add(record.path, event.toolCall.toolName);
      }
      if (Array.isArray(record.files)) {
        for (const file of record.files as Array<{
          oldPath?: string;
          newPath?: string;
          changed?: boolean;
        }>) {
          if (file.changed === false) continue;
          add(file.newPath ?? file.oldPath ?? "?", "patch");
        }
      }
      if (record.approval && typeof record.approval === "object") {
        const approval = record.approval as {
          details?: { kind?: string; preview?: unknown };
        };
        if (
          approval.details?.kind === "patch_apply" &&
          approval.details.preview &&
          typeof approval.details.preview === "object" &&
          "files" in approval.details.preview
        ) {
          const summary = formatPatchPreviewSummary(
            approval.details.preview as Parameters<
              typeof formatPatchPreviewSummary
            >[0],
          );
          add(summary, "patch 预览");
        }
      }
    }
  }

  return items;
}

import type { TaskReasoning } from "@/agent/core/loop-reasoning";
import type { TaskPlaybookId } from "@/agent/core/task-playbooks";
import { applyWorkspaceStructureToRunState } from "@/agent/core/loop-replicate-nudge";
import type { WorkspaceStructureFacts } from "@/agent/workspace/workspace-structure-facts";
import { isNativeToolLoopEnabled } from "@/agent/core/loop-protocol";
import {
  buildDeliverableCheckpointBlock,
  isEditDeliverableSatisfied,
} from "@/agent/core/loop-deliverable";
import {
  buildUiDisambiguationReadNudgeBlock,
  buildUiPrepareNudgeBlock,
} from "@/agent/core/ui-prepare-nudge";
import { formatPostExecuteFeedbackBlock } from "@/agent/verification/post-execute-verify";

export type AgentLoopRunState = {
  userRequest: string;
  likelyEditRequest: boolean;
  approvalPrepared: boolean;
  /** A112：已通过 file.replace / file.mutation / patch.apply 直接写盘 */
  editApplied?: boolean;
  /** 已落盘路径（用于交付物判定，非 tool 计数） */
  filesWritten?: string[];
  /** 当前任务匹配的 playbook（交付标准） */
  playbookId?: TaskPlaybookId;
  toolsCalled: string[];
  filesRead: string[];
  /** UI label 多文件命中时的消歧状态（A076） */
  disambiguation?: {
    label: string;
    mustReadPaths: string[];
    recommendedPath: string;
    selectionRationale: string;
  };
  lastToolError?: string;
  lastPrepareError?: string;
  reflectionRounds: number;
  /** UI 任务读完推荐文件后的 exact search 候选（A083） */
  prepareHint?: {
    path: string;
    suggestedSearchLines: string[];
  };
  /** 上一轮审批执行后 lint/typecheck 失败摘要（A086） */
  postExecuteFeedback?: {
    summary: string;
    failedCommand?: string;
    outputSnippet?: string;
    changedPaths: string[];
    approvalId?: string;
    taskId?: string;
  };
  /** A089：试用/调试时禁止 edit.recovery */
  strictPrepare?: boolean;
  /** 同一工具连续失败次数（熔断空转） */
  toolFailureStreak?: { tool: string; error: string; count: number };
  /** 首轮模型结构化推理（通用 intent / 证据 / 计划） */
  taskReasoning?: TaskReasoning;
  reasoningCompleted?: boolean;
  /** 用户要可展示思考过程（meta），允许凭 thread memory final */
  metaExplainMode?: boolean;
  /** 只读任务证据已齐，应直接 final（通用收口） */
  taskEvidenceComplete?: boolean;
  /** A153：workspace 检测到的框架（供 metadata catalog） */
  workspaceFramework?: string | null;
  /** 复刻任务：workspace.inspect 结构事实 */
  workspaceHasPackageJson?: boolean;
  workspaceLooksEmpty?: boolean;
  /** Deferred tools unlocked by tool.search. */
  discoveredToolNames?: string[];
};

export function createAgentLoopRunState(
  userRequest: string,
): AgentLoopRunState {
  return {
    userRequest,
    likelyEditRequest: isLikelyCodeEditRequest(userRequest),
    approvalPrepared: false,
    toolsCalled: [],
    filesRead: [],
    reflectionRounds: 0,
  };
}

/** 用户明确要求只读、不写盘、不执行时，不应走改代码审批链路。 */
export function isExplicitReadOnlyRequest(input: string): boolean {
  const readOnlyPatterns = [
    /只读/,
    /read[-\s]?only/i,
    /不要\s*修改/,
    /不要\s*写(?:入|盘|文件)?/,
    /不要\s*执行/,
    /不修改任何/,
    /不执行写盘/,
    /只准备[、,，]?\s*不执行/,
    /do\s+not\s+modif/i,
    /without\s+modif/i,
  ];
  return readOnlyPatterns.some((pattern) => pattern.test(input));
}

export function isLikelyCodeEditRequest(
  input: string,
  reasoning?: TaskReasoning,
): boolean {
  if (reasoning) {
    if (
      reasoning.intent === "code_edit" ||
      reasoning.intent === "mixed" ||
      reasoning.intent === "shell"
    ) {
      return true;
    }
    if (reasoning.risk === "write" || reasoning.risk === "approval_required") {
      return true;
    }
    return false;
  }

  if (isExplicitReadOnlyRequest(input)) return false;

  const stripped = input
    .toLowerCase()
    .replace(/不要\s*修改[^。；\n]*/g, " ")
    .replace(/不要\s*改[^变][^。；\n]*/g, " ")
    .replace(/不修改[^。；\n]*/g, " ");

  return /修改|改成|替换|删除|移除|去掉|新增|添加|写到|写入|复刻|实现|创建|生成|fix|edit|write|implement|add|create|remove|delete|change|update|patch/i.test(
    stripped,
  );
}

export function recordToolCall(
  state: AgentLoopRunState,
  toolName: string,
  result: unknown,
  error?: string,
): void {
  state.toolsCalled.push(toolName);

  if (
    toolName === "workspace.inspect" &&
    result &&
    typeof result === "object"
  ) {
    const structure = (result as { structure?: WorkspaceStructureFacts })
      .structure;
    if (structure) {
      applyWorkspaceStructureToRunState(state, structure);
    }
  }

  if (toolName === "file.read" && result && typeof result === "object") {
    const path = (result as { path?: unknown }).path;
    if (typeof path === "string" && !state.filesRead.includes(path)) {
      state.filesRead.push(path);
    }
  }

  if (
    (toolName === "file.locate" || toolName === "ui.trace_from_page") &&
    result &&
    typeof result === "object"
  ) {
    const raw = (
      result as {
        disambiguation?: {
          label?: string;
          primaryLabel?: string;
          mustReadPaths?: string[];
          recommendedPath?: string;
          selectionRationale?: string;
          summary?: string;
        };
      }
    ).disambiguation;
    if (raw && typeof raw.recommendedPath === "string") {
      state.disambiguation = {
        label:
          (typeof raw.label === "string" && raw.label) ||
          (typeof raw.primaryLabel === "string" && raw.primaryLabel) ||
          "",
        mustReadPaths: Array.isArray(raw.mustReadPaths)
          ? raw.mustReadPaths
          : [],
        recommendedPath: raw.recommendedPath,
        selectionRationale:
          (typeof raw.selectionRationale === "string" &&
            raw.selectionRationale) ||
          (typeof raw.summary === "string" && raw.summary) ||
          "",
      };
    }
  }

  if (error) {
    state.lastToolError = error;
    if (
      state.toolFailureStreak?.tool === toolName &&
      state.toolFailureStreak.error === error
    ) {
      state.toolFailureStreak.count += 1;
    } else {
      state.toolFailureStreak = { tool: toolName, error, count: 1 };
    }
    if (
      toolName === "file.replace.prepare" ||
      toolName === "file.mutation.prepare" ||
      toolName === "patch.prepare"
    ) {
      state.lastPrepareError = error;
    }
    return;
  }

  if (result && typeof result === "object" && "error" in result) {
    const message = String((result as { error?: unknown }).error);
    state.lastToolError = message;
    if (
      state.toolFailureStreak?.tool === toolName &&
      state.toolFailureStreak.error === message
    ) {
      state.toolFailureStreak.count += 1;
    } else {
      state.toolFailureStreak = { tool: toolName, error: message, count: 1 };
    }
    if (
      toolName === "file.replace.prepare" ||
      toolName === "file.mutation.prepare" ||
      toolName === "patch.prepare"
    ) {
      state.lastPrepareError = message;
    }
  } else if (
    toolName === "file.replace.prepare" ||
    toolName === "file.mutation.prepare" ||
    toolName === "patch.prepare" ||
    toolName === "file.replace" ||
    toolName === "file.mutation" ||
    toolName === "patch.apply"
  ) {
    state.toolFailureStreak = undefined;
    state.lastPrepareError = undefined;
    state.lastToolError = undefined;
    if (
      toolName === "file.replace" ||
      toolName === "file.mutation" ||
      toolName === "patch.apply"
    ) {
      state.editApplied = true;
      state.approvalPrepared = true;
    }
  } else {
    state.toolFailureStreak = undefined;
    state.lastToolError = undefined;
  }
}

export function buildRuntimeCheckpoint(state: AgentLoopRunState): string {
  const hasIssue = Boolean(
    state.lastToolError || state.lastPrepareError || state.postExecuteFeedback,
  );

  const lines = [
    "=== Runtime checkpoint ===",
    `User request: ${state.userRequest}`,
    `Edit applied: ${state.editApplied ? "yes" : "no"}`,
    `Files written: ${state.filesWritten?.length ? state.filesWritten.join(", ") : "(none yet)"}`,
    `Files read: ${state.filesRead.length > 0 ? state.filesRead.join(", ") : "(none yet)"}`,
  ];
  if (state.discoveredToolNames?.length) {
    lines.push(`Unlocked tools: ${state.discoveredToolNames.join(", ")}`);
  }
  if (state.metaExplainMode) {
    lines.push("Meta explain mode: expand visible reasoning for the user.");
  }
  if (state.strictPrepare) {
    lines.push("Strict prepare mode: use prepare tools for write approval.");
  }
  if (state.taskEvidenceComplete) {
    lines.push(
      "Task evidence complete: gather is sufficient — respond with Chinese final (no more tools).",
    );
  }
  if (state.taskReasoning) {
    lines.push(
      `Task intent: ${state.taskReasoning.intent} · risk: ${state.taskReasoning.risk}`,
    );
    if (state.taskReasoning.planSteps.length > 0) {
      lines.push(`Plan: ${state.taskReasoning.planSteps.join(" → ")}`);
    }
  }

  if (state.postExecuteFeedback) {
    lines.push(formatPostExecuteFeedbackBlock(state.postExecuteFeedback));
  }

  const disambiguationNudge = buildUiDisambiguationReadNudgeBlock(state);
  if (disambiguationNudge) {
    lines.push(disambiguationNudge);
  }

  if (hasIssue || state.strictPrepare) {
    if (state.lastToolError) {
      lines.push(`Last tool issue: ${state.lastToolError}`);
    }
    if (state.lastPrepareError) {
      lines.push(
        `Last prepare issue: ${state.lastPrepareError}`,
        "Use file.read and copy an exact substring for file.replace.",
      );
    }

    const prepareNudge = buildUiPrepareNudgeBlock(state);
    if (prepareNudge && !state.editApplied && state.lastPrepareError) {
      lines.push(prepareNudge);
    }
  }

  if (isExplicitReadOnlyRequest(state.userRequest)) {
    lines.push("Read-only task: do not mutate files.");
  }

  if (
    state.likelyEditRequest &&
    !isEditTaskSatisfied(state, state.playbookId) &&
    (hasIssue || state.strictPrepare)
  ) {
    const deliverableBlock = buildDeliverableCheckpointBlock(
      state,
      state.playbookId,
    );
    if (deliverableBlock) {
      lines.push(deliverableBlock);
    }
  }

  lines.push(
    isNativeToolLoopEnabled()
      ? "Use tool calls to read or edit files; reply with plain text when done."
      : 'Respond with JSON only: {"action":"reflect"|"tool_call"|"final",...}',
  );

  return lines.join("\n");
}

export function isEditTaskSatisfied(
  state: AgentLoopRunState,
  playbookId?: TaskPlaybookId,
): boolean {
  const pid = playbookId ?? state.playbookId;
  if (state.approvalPrepared && !state.editApplied) return true;
  if (!state.editApplied) return false;
  return isEditDeliverableSatisfied(state, pid);
}

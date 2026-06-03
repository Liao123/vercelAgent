/**
 * Agent Loop 运行态：供反思检查点生成结构化摘要（不猜用户句式）。
 */
export type AgentLoopRunState = {
  userRequest: string;
  likelyEditRequest: boolean;
  approvalPrepared: boolean;
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
};

export function createAgentLoopRunState(userRequest: string): AgentLoopRunState {
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

export function isLikelyCodeEditRequest(input: string): boolean {
  if (isExplicitReadOnlyRequest(input)) return false;

  const normalized = input.toLowerCase();
  const stripped = normalized
    .replace(/不要\s*修改[^。；\n]*/g, " ")
    .replace(/不要\s*改[^变][^。；\n]*/g, " ")
    .replace(/不修改[^。；\n]*/g, " ");

  const editKeywords = [
    "修改",
    "改成",
    "改为",
    "替换",
    "删除",
    "移除",
    "去掉",
    "新增",
    "添加",
    "重构",
    "rename",
    "replace",
    "remove",
    "delete",
    "change",
    "update",
  ];
  return editKeywords.some((keyword) => stripped.includes(keyword));
}

export function recordToolCall(
  state: AgentLoopRunState,
  toolName: string,
  result: unknown,
  error?: string,
): void {
  state.toolsCalled.push(toolName);

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
    const raw = (result as {
      disambiguation?: {
        label?: string;
        primaryLabel?: string;
        mustReadPaths?: string[];
        recommendedPath?: string;
        selectionRationale?: string;
        summary?: string;
      };
    }).disambiguation;
    if (raw && typeof raw.recommendedPath === "string") {
      state.disambiguation = {
        label:
          (typeof raw.label === "string" && raw.label) ||
          (typeof raw.primaryLabel === "string" && raw.primaryLabel) ||
          "",
        mustReadPaths: Array.isArray(raw.mustReadPaths) ? raw.mustReadPaths : [],
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
      toolName === "file.replace.prepare" ||
      toolName === "file.mutation.prepare" ||
      toolName === "patch.prepare"
    ) {
      state.lastPrepareError = message;
    }
  } else if (
    toolName === "file.replace.prepare" ||
    toolName === "file.mutation.prepare" ||
    toolName === "patch.prepare"
  ) {
    state.lastPrepareError = undefined;
  }
}

import {
  hasUiLocationEvidence,
  isUiLocationQuery,
} from "@/agent/core/prepare-gate";
import {
  buildUiDisambiguationReadNudgeBlock,
  buildUiPrepareNudgeBlock,
} from "@/agent/core/ui-prepare-nudge";
import { formatPostExecuteFeedbackBlock } from "@/agent/verification/post-execute-verify";

export function buildRuntimeCheckpoint(state: AgentLoopRunState): string {
  const lines = [
    "=== Runtime checkpoint (reflect before you finalize) ===",
    `User request: ${state.userRequest}`,
    `Edit-like request: ${state.likelyEditRequest ? "yes" : "no"}`,
    `Approval prepared: ${state.approvalPrepared ? "yes" : "no"}`,
    `Tools used: ${state.toolsCalled.length > 0 ? state.toolsCalled.join(" → ") : "(none yet)"}`,
    `Files read: ${state.filesRead.length > 0 ? state.filesRead.join(", ") : "(none yet)"}`,
  ];

  if (state.postExecuteFeedback) {
    lines.push(formatPostExecuteFeedbackBlock(state.postExecuteFeedback));
  }

  const disambiguationNudge = buildUiDisambiguationReadNudgeBlock(state);
  if (disambiguationNudge) {
    lines.push(disambiguationNudge);
  } else if (state.disambiguation) {
    lines.push(
      `UI disambiguation (${state.disambiguation.label}): recommend ${state.disambiguation.recommendedPath}.`,
      `Rationale: ${state.disambiguation.selectionRationale}`,
      "All disambiguation candidates read. In reflect, briefly explain why you chose the recommended file over alternatives before prepare.",
    );
  }

  if (state.lastToolError) {
    lines.push(`Last tool issue: ${state.lastToolError}`);
  }
  if (state.lastPrepareError) {
    lines.push(
      `Last prepare issue: ${state.lastPrepareError}`,
      "If search text was not found, you likely guessed from Chinese phrasing. Use file.read again and copy an exact substring, or file.search for a short literal.",
    );
  }

  const prepareNudge = buildUiPrepareNudgeBlock(state);
  if (prepareNudge) {
    lines.push(prepareNudge);
  }

  if (isExplicitReadOnlyRequest(state.userRequest)) {
    lines.push(
      "This is a read-only task: use inspect/read/search/git status tools only; do not prepare file or patch approvals.",
      "You may action=final once you have enough evidence.",
    );
  } else if (state.likelyEditRequest && !state.approvalPrepared) {
    lines.push(
      "Required for this task: produce exactly one approval via file.replace.prepare, file.mutation.prepare, or patch.prepare.",
      "Do not action=final until approval exists or you have exhausted reasonable tool strategies.",
      "Suggested flow: file.locate → file.read → (optional file.search) → file.replace.prepare with exact search from disk.",
      "Prepare gate: target file MUST be in Files read above; UI/homepage edits MUST call ui.trace_from_page or file.locate first; do NOT prepare edits under src/agent/core/* for UI tasks.",
    );
  } else if (state.approvalPrepared) {
    lines.push(
      "An approval is ready for the user. You may action=final with a short summary telling them to approve and execute in the UI.",
    );
  }

  lines.push(
    'Respond with JSON only. Prefer {"action":"reflect",...} to think, or {"action":"tool_call",...} for the next step.',
  );

  return lines.join("\n");
}

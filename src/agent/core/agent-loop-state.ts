/**
 * Agent Loop 运行态：供反思检查点生成结构化摘要（不猜用户句式）。
 */
export type AgentLoopRunState = {
  userRequest: string;
  likelyEditRequest: boolean;
  approvalPrepared: boolean;
  toolsCalled: string[];
  filesRead: string[];
  lastToolError?: string;
  lastPrepareError?: string;
  reflectionRounds: number;
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

export function isLikelyCodeEditRequest(input: string): boolean {
  const normalized = input.toLowerCase();
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
  return editKeywords.some((keyword) => normalized.includes(keyword));
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

  if (error) {
    state.lastToolError = error;
    if (
      toolName === "file.replace.prepare" ||
      toolName === "file.mutation.prepare"
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
      toolName === "file.mutation.prepare"
    ) {
      state.lastPrepareError = message;
    }
  } else if (
    toolName === "file.replace.prepare" ||
    toolName === "file.mutation.prepare"
  ) {
    state.lastPrepareError = undefined;
  }
}

export function buildRuntimeCheckpoint(state: AgentLoopRunState): string {
  const lines = [
    "=== Runtime checkpoint (reflect before you finalize) ===",
    `User request: ${state.userRequest}`,
    `Edit-like request: ${state.likelyEditRequest ? "yes" : "no"}`,
    `Approval prepared: ${state.approvalPrepared ? "yes" : "no"}`,
    `Tools used: ${state.toolsCalled.length > 0 ? state.toolsCalled.join(" → ") : "(none yet)"}`,
    `Files read: ${state.filesRead.length > 0 ? state.filesRead.join(", ") : "(none yet)"}`,
  ];

  if (state.lastToolError) {
    lines.push(`Last tool issue: ${state.lastToolError}`);
  }
  if (state.lastPrepareError) {
    lines.push(
      `Last prepare issue: ${state.lastPrepareError}`,
      "If search text was not found, you likely guessed from Chinese phrasing. Use file.read again and copy an exact substring, or file.search for a short literal.",
    );
  }

  if (state.likelyEditRequest && !state.approvalPrepared) {
    lines.push(
      "Required for this task: produce exactly one approval via file.replace.prepare or file.mutation.prepare.",
      "Do not action=final until approval exists or you have exhausted reasonable tool strategies.",
      "Suggested flow: file.locate → file.read → (optional file.search) → file.replace.prepare with exact search from disk.",
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

/**
 * 模型驱动 Agent Loop（理解 → 取证 → 行动 → 反思）。
 *
 * 通用编程能力：不依赖中文句式硬编码；通过工具观察 + 显式反思检查点推进任务。
 */
import {
  type AgentLoopToolContext,
} from "@/agent/core/agent-loop-tools";
import { tryRecoverEditApproval } from "@/agent/core/edit-recovery";
import {
  buildFinalPrepareNudgeUserMessage,
  isPrepareToolName,
  shouldRunFinalPrepareNudge,
} from "@/agent/core/final-prepare-nudge";
import {
  attemptGracefulLoopFinal,
  GRACEFUL_FINAL_DEFAULT_SUMMARY,
} from "@/agent/core/loop-graceful-final";
import {
  buildEditIncompleteGracefulHint,
  buildEditWritePressureNudge,
  buildEditWriteTailNudge,
  buildWorkspaceScaffoldNudge,
  computeLoopIterationCap,
  isEditWriteTaskPending,
  shouldForceFinalIteration,
  shouldRejectTextOnlyFinal,
  shouldSkipTextOnlyGracefulFinal,
} from "@/agent/core/loop-edit-write-tail";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";
import { shouldSkipEditRecoveryForUiPrepare } from "@/agent/core/ui-prepare-nudge";
import { parseCompactedMemory } from "@/agent/memory/loop-context-compactor";
import {
  loadStoredPostExecuteVerification,
  clearStoredPostExecuteVerification,
  postExecuteFeedbackFromStored,
} from "@/agent/verification/post-execute-verify";
import { isPostExecuteFixContinuation } from "@/lib/agent-lint-reloop";
import {
  buildRuntimeCheckpoint,
  createAgentLoopRunState,
  isExplicitReadOnlyRequest,
  recordToolCall,
  type AgentLoopRunState,
} from "@/agent/core/agent-loop-state";
import {
  completedAgentLoopPlan,
  createAgentLoopPlan,
  syncAgentLoopPlanProgress,
  type PlanProgressHint,
} from "@/agent/core/agent-loop-plan";
import {
  createConfiguredModelProvider,
  type ModelProvider,
} from "@/agent/model";
import type { ModelOutput } from "@/agent/model/types";
import {
  agentMessagesHaveImages,
  buildAgentUserContent,
} from "@/lib/build-agent-user-content";
import { getApiConfig } from "@/lib/openai-config";
import {
  appendTraceEvent,
  createTrace,
  updateTraceThread,
} from "@/agent/trace/trace-store";
import { buildTraceCheckpointEvent } from "@/agent/trace/trace-checkpoint";
import type { LoopShellCheckpoint } from "@/agent/core/loop-shell-checkpoint";
import {
  newId,
  nowIso,
  type AgentEvent,
  type AgentMessage,
  type AgentReflection,
  type Task,
  type Thread,
  type ToolCallRecord,
  type Turn,
} from "@/agent/types";
import { isSemanticCompactEnabled } from "@/agent/memory/loop-compaction-config";
import {
  buildThreadMemoryAfterTask,
  buildToolObservationMessage,
  compactAgentLoopMessages,
  createLoopCompactEventPayload,
  shouldApplyCompactionMessages,
} from "@/agent/memory/loop-context-compactor";
import { isContextOverflowError } from "@/agent/memory/loop-compaction-layers";
import {
  buildThreadMemoryInjectionMessage,
  getThreadMemory,
  saveThreadMemory,
} from "@/agent/memory/thread-memory-store";
import { getCurrentWorkspace } from "@/agent/workspace";
import { workspaceToSnapshotInput } from "@/agent/workspace/workspace-snapshot-prompt";
import {
  collectWorkspaceStructureFacts,
  formatWorkspaceStructureFactsForPrompt,
} from "@/agent/workspace/workspace-structure-facts";
import {
  isEditRecoveryEnabled,
  isEditTaskSatisfied,
  isFinalPrepareNudgeEnabled,
} from "@/agent/core/loop-direct-apply";
import {
  formatAttachedFilesUserNote,
  mergeAttachedPaths,
  mergeAttachedSelections,
  parseAtPathsFromRequest,
  preloadAttachedFiles,
  type EditorSelectionContext,
} from "@/agent/core/attached-files";
import { createLoopSystemPrompt } from "@/agent/prompts/create-loop-system-prompt";
import { isNativeToolLoopEnabled } from "@/agent/core/loop-protocol";
import { generateLoopModelWithProgress } from "@/agent/core/loop-model-generate";
import {
  buildLoopToolDefinitions,
  invalidateLoopToolDefinitionCache,
  parseToolCallArguments,
} from "@/agent/model/loop-tool-schemas";
import { ensureMcpRegistryReady, getMcpRegistrySnapshot } from "@/agent/mcp";
import {
  runAgentLoopToolCall,
  type AgentLoopToolRunnerDeps,
} from "@/agent/core/agent-loop-tool-runner";
import type { AgentUiContext } from "@/agent/types";
import {
  buildSoftRoundBudgetHint,
  collectPlaybookAcceleratorHints,
  computePlaybookProgress,
  countToolRounds,
  resolveTaskPlaybook,
} from "@/agent/core/task-playbooks";
import {
  attachReasoningToRunState,
  buildPostReasoningHint,
  buildAdaptiveReasoningSkipHint,
  buildReasoningTurnUserMessage,
  evaluateReasoningTurn,
  formatReasoningForMessages,
  isMetaExplainRequest,
  normalizeTaskReasoning,
  parseTaskReasoning,
  reasoningToReflection,
} from "@/agent/core/loop-reasoning";
import {
  formatModelErrorMessage,
  formatModelFailureSummary,
} from "@/lib/model-error-message";
import { attemptDeterministicModelFailureRecovery } from "@/agent/core/loop-deterministic-recovery";
import { isDeterministicRecoveryEnabled } from "@/agent/core/loop-graceful-recovery-config";
import { canParallelizeGatherBatch } from "@/agent/core/parallel-gather";
import {
  isShellLoopResumeEnabled,
  saveLoopShellCheckpoint,
  consumeLoopShellCheckpoint,
  type PendingShellApproval,
} from "@/agent/core/loop-shell-checkpoint";
import {
  applyShellExecutionToMessages,
  buildShellExecutionResumeMessage,
  pendingShellFromToolRun,
  type ShellLoopResumeInput,
} from "@/agent/core/shell-loop-resume";
import { buildApprovalLoopContinuationRequest } from "@/lib/approval-loop-continuation";
import {
  LOOP_USER_CANCEL_MESSAGE,
} from "@/agent/core/loop-cancel";

export type AgentLoopInput = {
  userRequest: string;
  /** 参考图 data URL（走 vision 模型） */
  referenceImages?: string[];
  maxIterations?: number;
  model?: string;
  /** 延续已有 Thread，并注入其滚动任务记忆 */
  threadId?: string;
  /** 产品 UI 运行时上下文（layout、当前路由） */
  uiContext?: AgentUiContext;
  /** 用户手动附加的文件路径（与 @path 合并预读） */
  attachedPaths?: string[];
  /** 审查区/编辑器选区（与 @path#Lx-y 合并） */
  attachedSelections?: EditorSelectionContext[];
  /** 为 true 时禁止 edit.recovery，强制模型走 prepare（与试用 --strict 对齐） */
  strictPrepare?: boolean;
  /** A151：shell 批准后同 Loop 上下文续跑（需有效 checkpoint） */
  shellResume?: ShellLoopResumeInput;
  /** A165：客户端断开或用户停止时 abort */
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};

export type AgentLoopResult = {
  traceId: string;
  thread: Thread;
  task: Task;
  turn: Turn;
  events: AgentEvent[];
  summary: string;
};

type AgentLoopDecision =
  | {
      action: "tool_call";
      tool: string;
      args?: Record<string, unknown>;
      thought?: string;
    }
  | {
      action: "reflect";
      understanding: string;
      blockers?: string[];
      plannedNext: string;
      thought?: string;
    }
  | {
      action: "final";
      summary: string;
      thought?: string;
    };

const DEFAULT_MAX_ITERATIONS = 14;
const MAX_LOOP_ITERATION_CAP = 20;
const MAX_REFLECTION_ROUNDS = 4;

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function toDecision(value: unknown): AgentLoopDecision | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as {
    action?: unknown;
    tool?: unknown;
    args?: unknown;
    summary?: unknown;
    thought?: unknown;
    understanding?: unknown;
    blockers?: unknown;
    plannedNext?: unknown;
  };

  if (parsed.action === "tool_call" && typeof parsed.tool === "string") {
    const args =
      parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    return {
      action: "tool_call",
      tool: parsed.tool,
      args,
      thought: typeof parsed.thought === "string" ? parsed.thought : undefined,
    };
  }

  if (
    parsed.action === "reflect" &&
    typeof parsed.understanding === "string" &&
    typeof parsed.plannedNext === "string"
  ) {
    const blockers = Array.isArray(parsed.blockers)
      ? parsed.blockers.filter((item): item is string => typeof item === "string")
      : undefined;
    return {
      action: "reflect",
      understanding: parsed.understanding,
      blockers,
      plannedNext: parsed.plannedNext,
      thought: typeof parsed.thought === "string" ? parsed.thought : undefined,
    };
  }

  if (parsed.action === "final" && typeof parsed.summary === "string") {
    return {
      action: "final",
      summary: parsed.summary,
      thought: typeof parsed.thought === "string" ? parsed.thought : undefined,
    };
  }

  if (
    typeof parsed.summary === "string" &&
    typeof parsed.tool !== "string" &&
    parsed.action !== "tool_call"
  ) {
    return {
      action: "final",
      summary: parsed.summary,
      thought: typeof parsed.thought === "string" ? parsed.thought : undefined,
    };
  }

  return null;
}

function parseDecision(content: string): AgentLoopDecision {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const jsonText = fenced?.[1] ?? trimmed;

  try {
    const direct = toDecision(JSON.parse(jsonText));
    if (direct) return direct;
  } catch {
    // Fall through to candidate extraction below.
  }

  for (const candidate of extractJsonObjectCandidates(jsonText)) {
    try {
      const parsed = JSON.parse(candidate);
      const decision = toDecision(parsed);
      if (decision) return decision;
    } catch {
      continue;
    }
  }

  throw new Error("Model returned an unsupported or invalid agent loop decision.");
}

function createToolCall(
  taskId: string,
  toolName: string,
  args: unknown,
  rationale?: string,
): ToolCallRecord {
  return {
    id: newId("tool"),
    taskId,
    toolName,
    args,
    ...(rationale ? { rationale } : {}),
    startedAt: nowIso(),
  };
}

function completeToolCall(call: ToolCallRecord, error?: string): ToolCallRecord {
  return {
    ...call,
    completedAt: nowIso(),
    error,
  };
}

function taskReasoningPinFromRunState(
  taskReasoning?: import("@/agent/core/loop-reasoning").TaskReasoning,
) {
  if (!taskReasoning) return null;
  return {
    intent: taskReasoning.intent,
    risk: taskReasoning.risk,
    evidenceNeeded: taskReasoning.evidenceNeeded,
    ambiguity: taskReasoning.ambiguity,
  };
}

function fallbackSummary(error: unknown): string {
  return formatModelErrorMessage(error);
}

function observationMessage(
  toolName: string,
  result: unknown,
  rootPath: string,
  toolCallId?: string,
): AgentMessage {
  return buildToolObservationMessage(toolName, result, {
    workspaceRoot: rootPath,
    toolName,
    toolCallId,
  });
}

function emitReflection(
  emit: (event: AgentEvent) => void,
  taskId: string,
  reflection: AgentReflection,
): void {
  emit({ type: "reflection.updated", taskId, reflection, at: nowIso() });
}

function buildReflectionUserMessage(
  reflection: AgentReflection,
  checkpoint?: string,
): AgentMessage {
  const parts = [
    checkpoint,
    `Reflection (${reflection.source}):`,
    `理解: ${reflection.understanding}`,
    reflection.blockers.length > 0
      ? `阻塞: ${reflection.blockers.join("; ")}`
      : "阻塞: (无)",
    `下一步: ${reflection.plannedNext}`,
    "Continue with tool_call or reflect—do not finalize edit tasks without approval unless impossible.",
  ].filter(Boolean);

  return {
    role: "user",
    content: parts.join("\n"),
  };
}

function pushReflectionToMessages(
  messages: AgentMessage[],
  reflection: AgentReflection,
  checkpoint?: string,
): void {
  messages.push(buildReflectionUserMessage(reflection, checkpoint));
}

function flushDeferredPostToolTurnMessages(
  messages: AgentMessage[],
  deferred: AgentMessage[],
): void {
  if (deferred.length === 0) return;
  messages.push(...deferred);
  deferred.length = 0;
}

function emitRecoveryApprovalEvents(
  emit: (event: AgentEvent) => void,
  taskId: string,
  recovery: Extract<Awaited<ReturnType<typeof tryRecoverEditApproval>>, { ok: true }>,
): void {
  const toolCall = createToolCall(taskId, "edit.recovery", {
    path: recovery.path,
    search: recovery.search,
    strategy: recovery.strategy,
  });
  emit({ type: "tool.started", taskId, toolCall });
  emit({
    type: "tool.completed",
    taskId,
    toolCall: completeToolCall(toolCall),
    result: {
      path: recovery.path,
      search: recovery.search,
      replace: recovery.replace,
      approval: recovery.approval,
      strategy: recovery.strategy,
    },
  });
  emit({
    type: "approval.required",
    taskId,
    approval: recovery.approval,
  });
}

async function attemptEditRecovery(
  emit: (event: AgentEvent) => void,
  taskId: string,
  runState: AgentLoopRunState,
  rootPath: string,
  uiContext?: AgentUiContext,
): Promise<string | null> {
  if (!runState.likelyEditRequest || runState.approvalPrepared) return null;

  const recovery = await tryRecoverEditApproval({
    rootPath,
    taskId,
    userRequest: runState.userRequest,
    filesRead: runState.filesRead,
    uiContext,
    skipRecovery:
      runState.strictPrepare === true ||
      shouldSkipEditRecoveryForUiPrepare(runState, uiContext),
  });

  if (!recovery) return null;

  if (recovery.ok) {
    runState.approvalPrepared = true;
    emitRecoveryApprovalEvents(emit, taskId, recovery);
    emitReflection(emit, taskId, {
      understanding: `磁盘恢复：已在 ${recovery.path} 中准备删除「${recovery.search}」。`,
      blockers: [],
      plannedNext: "请在界面批准并执行审批。",
      source: "runtime",
    });
    return `已通过磁盘证据恢复并生成审批：从 ${recovery.path} 删除「${recovery.search}」。请在审批区点击「批准并执行」。`;
  }

  return recovery.message;
}

function shouldInjectRuntimeReflection(state: AgentLoopRunState): boolean {
  if (state.reflectionRounds >= MAX_REFLECTION_ROUNDS) return false;
  if (isExplicitReadOnlyRequest(state.userRequest)) return false;
  if (state.lastToolError || state.lastPrepareError) return true;
  if (state.postExecuteFeedback && !isEditTaskSatisfied(state)) return true;
  return false;
}

function saveShellPauseAndCheckpoint(
  emit: (event: AgentEvent) => void,
  checkpoint: LoopShellCheckpoint,
  traceId: string,
): void {
  saveLoopShellCheckpoint(checkpoint);
  emit(
    buildTraceCheckpointEvent({
      taskId: checkpoint.taskId,
      traceId,
      checkpoint: {
        kind: "shell_paused",
        label: "",
        resumable: true,
        threadId: checkpoint.threadId,
        approvalId: checkpoint.pendingShell.approvalId,
        iteration: checkpoint.iteration,
        command: checkpoint.pendingShell.command,
      },
    }),
  );
}

function finishLoopCancelled(input: {
  trace: { id: string };
  thread: Thread;
  task: Task;
  turn: Turn;
  events: AgentEvent[];
  emit: (event: AgentEvent) => void;
}): AgentLoopResult {
  const cancelledAt = nowIso();
  const cancelledTask: Task = {
    ...input.task,
    status: "cancelled",
    updatedAt: cancelledAt,
    completedAt: cancelledAt,
    error: LOOP_USER_CANCEL_MESSAGE,
  };
  const cancelledTurn: Turn = {
    ...input.turn,
    status: "cancelled",
    updatedAt: cancelledAt,
    summary: LOOP_USER_CANCEL_MESSAGE,
  };
  input.emit(
    buildTraceCheckpointEvent({
      taskId: input.task.id,
      traceId: input.trace.id,
      checkpoint: {
        kind: "task_cancelled",
        label: "",
        reason: "user_abort",
      },
    }),
  );
  input.emit({
    taskId: input.task.id,
    task: cancelledTask,
    reason: "user_abort",
  });
  return {
    traceId: input.trace.id,
    thread: {
      ...input.thread,
      status: "cancelled",
      updatedAt: cancelledAt,
    },
    task: cancelledTask,
    turn: cancelledTurn,
    events: input.events,
    summary: LOOP_USER_CANCEL_MESSAGE,
  };
}

export async function runAgentLoop(
  input: AgentLoopInput,
  provider: ModelProvider | null = createConfiguredModelProvider(),
): Promise<AgentLoopResult> {
  if (!provider) {
    throw new Error("No model provider is configured.");
  }

  const now = nowIso();
  const workspace = await getCurrentWorkspace();
  await ensureMcpRegistryReady();
  invalidateLoopToolDefinitionCache();
  const mcpSnapshot = getMcpRegistrySnapshot();
  const workspaceSnapshot = workspaceToSnapshotInput(workspace);
  const workspaceStructureFacts = await collectWorkspaceStructureFacts(workspace);
  const workspaceStructureBlock =
    formatWorkspaceStructureFactsForPrompt(workspaceStructureFacts);
  const { cleanRequest, attachedPaths: parsedAttachedPaths, attachedSelections: parsedSelections } =
    parseAtPathsFromRequest(input.userRequest);
  let effectiveUserRequest = cleanRequest || input.userRequest;
  const attachedPaths = mergeAttachedPaths(
    input.attachedPaths,
    parsedAttachedPaths,
  );
  const attachedSelections = mergeAttachedSelections(
    input.attachedSelections,
    parsedSelections,
  );
  const priorThreadMemory = input.threadId
    ? getThreadMemory(input.threadId)
    : undefined;

  const shellCheckpoint =
    input.shellResume &&
    input.threadId &&
    isShellLoopResumeEnabled()
      ? consumeLoopShellCheckpoint(input.threadId, input.shellResume.approvalId)
      : null;

  if (
    input.shellResume &&
    input.threadId &&
    isShellLoopResumeEnabled() &&
    !shellCheckpoint
  ) {
    effectiveUserRequest = buildApprovalLoopContinuationRequest(
      {
        id: input.shellResume.approvalId,
        title: input.shellResume.result.command,
        details: { kind: "shell_command" },
        execution: {
          status: input.shellResume.result.success ? "succeeded" : "failed",
          result: {
            kind: "shell_command",
            command: input.shellResume.result.command,
            success: input.shellResume.result.success,
            output: input.shellResume.result.output,
          },
        },
      },
      { result: input.shellResume.result },
      priorThreadMemory?.lastUserRequest ?? null,
    );
  }

  const thread: Thread = {
    id: input.threadId ?? newId("thread"),
    workspaceId: workspace.id,
    title:
      (priorThreadMemory?.lastUserRequest?.slice(0, 40) ??
        input.userRequest.slice(0, 80)) ||
      "Agent loop task",
    status: "running",
    createdAt: now,
    updatedAt: now,
    contextSummary: priorThreadMemory?.memoryContent.slice(0, 400),
  };
  const referenceImages = (input.referenceImages ?? []).filter((url) =>
    url.startsWith("data:image/"),
  );
  const task: Task = {
    id: shellCheckpoint?.taskId ?? newId("task"),
    threadId: thread.id,
    workspaceId: workspace.id,
    userRequest: effectiveUserRequest,
    referenceImages:
      referenceImages.length > 0 ? referenceImages : undefined,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  const turn: Turn = {
    id: newId("turn"),
    threadId: thread.id,
    taskId: task.id,
    userInput: effectiveUserRequest,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  const trace = createTrace({
    id: newId("trace"),
    thread,
    task,
    turns: [turn],
    createdAt: now,
    updatedAt: now,
  });
  const plan = createAgentLoopPlan(effectiveUserRequest);
  const runState = shellCheckpoint
    ? {
        ...shellCheckpoint.runState,
        approvalPrepared: false,
      }
    : createAgentLoopRunState(effectiveUserRequest);
  if (!shellCheckpoint) {
    runState.metaExplainMode = isMetaExplainRequest(effectiveUserRequest);
  }
  if (input.strictPrepare) {
    runState.strictPrepare = true;
  }
  runState.workspaceFramework = workspaceSnapshot.framework ?? null;
  const storedPostExecute = await loadStoredPostExecuteVerification(
    workspace.rootPath,
  );
  let postExecuteFeedback = storedPostExecute
    ? postExecuteFeedbackFromStored(storedPostExecute)
    : null;
  if (postExecuteFeedback && !isPostExecuteFixContinuation(effectiveUserRequest)) {
    await clearStoredPostExecuteVerification(workspace.rootPath);
    postExecuteFeedback = null;
  }
  if (postExecuteFeedback) {
    runState.postExecuteFeedback = postExecuteFeedback;
  }
  const events: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
    appendTraceEvent(trace.id, event);
    input.onEvent?.(event);
  };
  const emitPlan = (hint: PlanProgressHint = {}) => {
    const nextPlan = syncAgentLoopPlanProgress(plan, runState, hint);
    plan.steps = nextPlan.steps;
    plan.updatedAt = nextPlan.updatedAt;
    emit({ type: "plan.updated", taskId: task.id, plan: { ...plan } });
  };
  if (!input.threadId) {
    emit({ type: "thread.created", threadId: thread.id, thread });
  }
  emit({ type: "task.created", taskId: task.id, task });
  emit({ type: "trace.linked", taskId: task.id, traceId: trace.id });
  emit(
    buildTraceCheckpointEvent({
      taskId: task.id,
      traceId: trace.id,
      checkpoint: { kind: "task_started", label: "" },
    }),
  );
  emit({ type: "turn.created", turnId: turn.id, turn });
  emitPlan();

  const taskPlaybook = resolveTaskPlaybook(effectiveUserRequest, runState);
  emit({
    type: "playbook.matched",
    taskId: task.id,
    playbookId: taskPlaybook.id,
    title: taskPlaybook.title,
    matchReason: taskPlaybook.matchReason,
    goldenSteps: taskPlaybook.goldenSteps.map((s) => s.label),
    softMaxToolRounds: taskPlaybook.softMaxToolRounds,
    at: nowIso(),
  });

  const emitPlaybookProgress = () => {
    const progress = computePlaybookProgress(taskPlaybook, runState.toolsCalled);
    emit({
      type: "playbook.progress",
      taskId: task.id,
      playbookId: taskPlaybook.id,
      title: taskPlaybook.title,
      progressLabel: progress.progressLabel,
      completedCount: progress.completedCount,
      totalSteps: progress.totalSteps,
      currentStepLabel: progress.currentStepLabel,
      completedStepIds: progress.completedStepIds,
      at: nowIso(),
    });
  };
  emitPlaybookProgress();

  const playbookHints = collectPlaybookAcceleratorHints(
    effectiveUserRequest,
    runState,
  );

  let messages: AgentMessage[];

  if (shellCheckpoint && input.shellResume) {
    effectiveUserRequest = shellCheckpoint.effectiveUserRequest;
    task.userRequest = effectiveUserRequest;
    messages = [...shellCheckpoint.messages];
    recordToolCall(
      runState,
      shellCheckpoint.pendingShell.toolName,
      input.shellResume.result,
    );
    const appliedToolResult = applyShellExecutionToMessages(messages, {
      pendingShell: shellCheckpoint.pendingShell,
      result: input.shellResume.result,
      priorUserRequest: shellCheckpoint.effectiveUserRequest,
    });
    if (!appliedToolResult) {
      messages.push({
        role: "user",
        content: buildShellExecutionResumeMessage({
          pendingShell: shellCheckpoint.pendingShell,
          result: input.shellResume.result,
          priorUserRequest: shellCheckpoint.effectiveUserRequest,
        }),
      });
    }
    emitReflection(emit, task.id, {
      understanding: `Shell 命令已执行（${input.shellResume.result.success ? "成功" : "失败"}），同 Loop 上下文续跑。`,
      blockers: input.shellResume.result.success
        ? []
        : [input.shellResume.result.output.slice(0, 240) || "命令失败"],
      plannedNext: "根据 shell 输出继续完成原定任务。",
      source: "runtime",
    });
    emitPlan({ lastAction: "tool" });
  } else {
  const reasoningMode = evaluateReasoningTurn({
    userRequest: effectiveUserRequest,
    likelyEditRequest: runState.likelyEditRequest,
    metaExplain: runState.metaExplainMode === true,
    hasReferenceImages: referenceImages.length > 0,
    hasPreloadedAttachments: attachedPaths.length > 0,
    hasPostExecuteFeedback: Boolean(postExecuteFeedback),
    isFixContinuation: isPostExecuteFixContinuation(effectiveUserRequest),
    hasThreadMemory: Boolean(priorThreadMemory?.memoryContent),
  });

  messages = [
    {
      role: "system",
      content: createLoopSystemPrompt(
        workspace.rootPath,
        input.uiContext,
        workspaceSnapshot,
        mcpSnapshot,
        workspaceStructureBlock,
      ),
    },
  ];
  if (priorThreadMemory?.memoryContent) {
    messages.push(
      buildThreadMemoryInjectionMessage(priorThreadMemory.memoryContent),
    );
    const priorMemory = parseCompactedMemory(priorThreadMemory.memoryContent);
    if (
      priorMemory?.pinnedPrepareHint &&
      runState.likelyEditRequest &&
      !runState.approvalPrepared &&
      isUiLocationQuery(effectiveUserRequest)
    ) {
      runState.prepareHint = priorMemory.pinnedPrepareHint;
    }
  }
  const userMessageText = [
    effectiveUserRequest,
    attachedPaths.length > 0
      ? formatAttachedFilesUserNote(attachedPaths, attachedSelections)
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  messages.push({
    role: "user",
    content: buildAgentUserContent(
      userMessageText,
      referenceImages.length > 0 ? referenceImages : undefined,
    ),
  });
  if (!shellCheckpoint) {
    const inspectResult = {
      rootPath: workspace.rootPath,
      gitRootPath: workspace.gitRootPath,
      packageManager: workspace.packageManager,
      framework: workspace.framework,
      packageName: workspace.packageName,
      structure: workspaceStructureFacts,
    };
    const inspectToolCall = createToolCall(
      task.id,
      "workspace.inspect",
      {},
      "启动时预载工作区结构事实。",
    );
    emit({ type: "tool.started", taskId: task.id, toolCall: inspectToolCall });
    emit({
      type: "tool.completed",
      taskId: task.id,
      toolCall: completeToolCall(inspectToolCall),
      result: inspectResult,
    });
    recordToolCall(runState, "workspace.inspect", inspectResult);
    if (isNativeToolLoopEnabled()) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: inspectToolCall.id,
            type: "function",
            function: {
              name: "workspace.inspect",
              arguments: "{}",
            },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: inspectToolCall.id,
        content: JSON.stringify(inspectResult),
      });
    } else {
      messages.push({
        role: "assistant",
        content: JSON.stringify({
          action: "tool_call",
          tool: "workspace.inspect",
          args: {},
          thought: "启动时预载工作区结构事实。",
        }),
      });
      messages.push(
        observationMessage(
          "workspace.inspect",
          inspectResult,
          workspace.rootPath,
          inspectToolCall.id,
        ),
      );
    }
  }
  if (attachedPaths.length > 0) {
    const preloaded = await preloadAttachedFiles({
      rootPath: workspace.rootPath,
      paths: attachedPaths,
      selections: attachedSelections,
    });
    for (const file of preloaded) {
      const result = file.error
        ? { path: file.path, error: file.error }
        : {
            path: file.path,
            content: file.content ?? "",
            truncated: file.truncated ?? false,
          };
      const toolCall = createToolCall(
        task.id,
        "file.read",
        { path: file.path },
        "用户附加文件，启动时预读。",
      );
      emit({ type: "tool.started", taskId: task.id, toolCall });
      emit({
        type: "tool.completed",
        taskId: task.id,
        toolCall: completeToolCall(toolCall),
        result,
      });
      if (!file.error) {
        recordToolCall(runState, "file.read", result);
      }
      messages.push({
        role: "assistant",
        content: JSON.stringify({
          action: "tool_call",
          tool: "file.read",
          args: { path: file.path },
          thought: "用户附加文件，启动时预读。",
        }),
      });
      messages.push(observationMessage("file.read", result, workspace.rootPath, toolCall.id));
    }
  }

  if (reasoningMode === "full") {
    messages.push({
      role: "user",
      content: buildReasoningTurnUserMessage({
        userRequest: effectiveUserRequest,
        playbookHints,
        uiContext: input.uiContext,
        hasThreadMemory: Boolean(priorThreadMemory?.memoryContent),
        metaExplain: runState.metaExplainMode === true,
        workspaceSnapshot,
        workspaceStructureBlock,
      }),
    });
    try {
      const loopModel =
        input.model ??
        (agentMessagesHaveImages(messages)
          ? getApiConfig()?.visionModel
          : undefined);
      const reasoningOutput = await generateLoopModelWithProgress(
        provider,
        {
          messages,
          model: loopModel,
          temperature: 0,
          maxTokens: 900,
          toolChoice: "none",
          metadata: { taskId: task.id, reasoningTurn: true },
        },
        emit,
        task.id,
      );
      const parsed = parseTaskReasoning(reasoningOutput.content);
      if (parsed) {
        const normalized = normalizeTaskReasoning(parsed, {
          userRequest: effectiveUserRequest,
          metaExplain: runState.metaExplainMode === true,
          hasThreadMemory: Boolean(priorThreadMemory?.memoryContent),
          filesReadCount: runState.filesRead.length,
          toolsCalledCount: runState.toolsCalled.length,
          workspaceFramework: runState.workspaceFramework,
        });
        attachReasoningToRunState(runState, normalized);
        const reflection = reasoningToReflection(normalized);
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(
          messages,
          reflection,
          buildRuntimeCheckpoint(runState),
        );
        messages.push({
          role: "assistant",
          content: formatReasoningForMessages(normalized),
        });
        const postHint = buildPostReasoningHint(
          normalized,
          runState.metaExplainMode === true,
        );
        if (postHint) {
          messages.push({ role: "user", content: postHint });
        }
        emitPlan({ lastAction: "reflect" });
      } else if (reasoningOutput.content?.trim()) {
        messages.push({
          role: "assistant",
          content: reasoningOutput.content.trim(),
        });
      }
    } catch {
      const fallbackReflection: AgentReflection = {
        understanding: effectiveUserRequest,
        blockers: postExecuteFeedback ? [postExecuteFeedback.summary] : [],
        plannedNext: postExecuteFeedback
          ? "先读 checkpoint 中 post-execute 失败摘要，修复相关文件后再 file.replace.prepare。"
          : "推理轮失败，请根据用户请求按需调用工具。",
        source: "runtime",
      };
      emitReflection(emit, task.id, fallbackReflection);
      pushReflectionToMessages(
        messages,
        fallbackReflection,
        buildRuntimeCheckpoint(runState),
      );
    }
  } else if (reasoningMode === "skip") {
    messages.push({
      role: "user",
      content: buildAdaptiveReasoningSkipHint({
        userRequest: effectiveUserRequest,
        playbookHints,
        uiContext: input.uiContext,
        hasThreadMemory: Boolean(priorThreadMemory?.memoryContent),
        workspaceSnapshot,
        workspaceStructureBlock,
      }),
    });
    const skipReflection: AgentReflection = {
      understanding: effectiveUserRequest,
      blockers: [],
      plannedNext:
        "自适应跳过 JSON 推理轮；仍须歧义分解与 gather 后再 final。",
      source: "runtime",
    };
    emitReflection(emit, task.id, skipReflection);
    pushReflectionToMessages(
      messages,
      skipReflection,
      buildRuntimeCheckpoint(runState),
    );
    emitPlan({ lastAction: "reflect" });
  } else {
    const openingReflection: AgentReflection = {
      understanding: `${taskPlaybook.title}：${effectiveUserRequest}`,
      blockers: postExecuteFeedback ? [postExecuteFeedback.summary] : [],
      plannedNext: postExecuteFeedback
        ? "先读 checkpoint 中 post-execute 失败摘要，修复相关文件后再 file.replace.prepare。"
        : attachedPaths.length > 0
          ? `已预读 ${attachedPaths.length} 个附加文件，请按需继续。`
          : "请根据用户请求按需调用工具。",
      source: "runtime",
    };
    emitReflection(emit, task.id, openingReflection);
    pushReflectionToMessages(
      messages,
      openingReflection,
      buildRuntimeCheckpoint(runState),
    );
    emitPlan();
  }
  }

  let toolContext: AgentLoopToolContext = {
    workspace,
    taskId: task.id,
    uiContext: input.uiContext,
    runState,
  };

  const deferredPostToolTurnMessages: AgentMessage[] = [];

  const toolRunnerDeps: AgentLoopToolRunnerDeps = {
    taskId: task.id,
    rootPath: workspace.rootPath,
    emit,
    runState,
    getToolContext: () => toolContext,
    setToolContext: (ctx) => {
      toolContext = ctx;
    },
    emitReflection: (reflection) => emitReflection(emit, task.id, reflection),
    pushReflectionToMessages: (reflection, checkpoint) => {
      deferredPostToolTurnMessages.push(
        buildReflectionUserMessage(reflection, checkpoint),
      );
    },
    shouldInjectRuntimeReflection,
    emitPlan,
    emitPlaybookProgress,
    playbook: taskPlaybook,
    fallbackSummary,
    pushUserNudge: (content) => {
      deferredPostToolTurnMessages.push({ role: "user", content });
    },
  };

  let summary = GRACEFUL_FINAL_DEFAULT_SUMMARY;
  let softBudgetHintInjected = false;
  let workspaceScaffoldNudgeInjected = false;
  const maxIterations = Math.min(
    Math.max(
      shellCheckpoint?.maxIterations ?? input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      1,
    ),
    MAX_LOOP_ITERATION_CAP,
  );
  const resumedIteration = shellCheckpoint?.iteration ?? 0;
  let pausedForShellApproval = false;
  let pausedShellApprovalId: string | null = null;

  let modelUnavailable = false;
  let contextCompactRound = 0;
  let reactiveCompactUsed = false;

  const loopIterationCap = Math.min(
    computeLoopIterationCap(maxIterations, runState),
    MAX_LOOP_ITERATION_CAP,
  );

  for (let iteration = resumedIteration + 1; iteration <= loopIterationCap; iteration += 1) {
    if (input.signal?.aborted) {
      return finishLoopCancelled({ trace, thread, task, turn, events, emit });
    }

    if (iteration > maxIterations && !isEditWriteTaskPending(runState)) {
      break;
    }

    if (
      !workspaceScaffoldNudgeInjected &&
      isEditWriteTaskPending(runState)
    ) {
      const scaffoldNudge = buildWorkspaceScaffoldNudge(workspaceStructureFacts);
      if (scaffoldNudge) {
        messages.push({ role: "user", content: scaffoldNudge });
        workspaceScaffoldNudgeInjected = true;
      }
    }

    if (iteration > maxIterations) {
      messages.push({
        role: "user",
        content: buildEditWriteTailNudge(iteration, maxIterations),
      });
    } else {
      const writePressure = buildEditWritePressureNudge(
        runState,
        iteration,
        maxIterations,
      );
      if (writePressure) {
        messages.push({ role: "user", content: writePressure });
      }
    }

    const shouldEmitProgressReflection =
      iteration > 1 &&
      (runState.lastToolError != null ||
        runState.lastPrepareError != null ||
        runState.toolsCalled.length > 0);
    if (shouldEmitProgressReflection) {
      emitReflection(emit, task.id, {
        understanding: `继续执行（第 ${iteration}/${maxIterations} 轮）`,
        blockers: [],
        plannedNext:
          runState.toolsCalled.length > 0
            ? `已调用 ${runState.toolsCalled.length} 次工具，正在继续…`
            : "正在选择下一步…",
        source: "runtime",
      });
    }

    const toolRounds = countToolRounds(runState.toolsCalled);
    const budgetHint = buildSoftRoundBudgetHint(taskPlaybook, toolRounds);
    if (budgetHint && !softBudgetHintInjected && iteration < maxIterations) {
      messages.push({ role: "user", content: budgetHint });
      softBudgetHintInjected = true;
    }

    const compactResult = await compactAgentLoopMessages({
      messages,
      userRequest: effectiveUserRequest,
      provider,
      enableSemanticCompact: isSemanticCompactEnabled(),
      compactRound: contextCompactRound + 1,
      filesReadPaths: runState.filesRead,
      prepareHint:
        runState.prepareHint && !runState.approvalPrepared
          ? runState.prepareHint
          : undefined,
      taskReasoning: taskReasoningPinFromRunState(runState.taskReasoning),
    });
    if (shouldApplyCompactionMessages(compactResult)) {
      messages.length = 0;
      messages.push(...compactResult.messages);
    }
    if (compactResult.method !== "none") {
      contextCompactRound = compactResult.round;
      const payload = createLoopCompactEventPayload(compactResult);
      if (payload) {
        const memoryContent =
          payload.memoryContent ?? compactResult.memoryContent;
        emit({
          type: "context.compacted",
          taskId: task.id,
          summaryId: payload.summaryId,
          method: payload.method,
          estimatedTokensBefore: payload.estimatedTokensBefore,
          estimatedTokensAfter: payload.estimatedTokensAfter,
          round: payload.round,
          middleMessageCount: payload.middleMessageCount,
          summaryPreview: payload.summaryPreview,
          memoryContent,
          threadId: thread.id,
          pinnedApprovalCount: payload.pinnedApprovalCount,
          changedFileCount: payload.changedFileCount,
          layersApplied: payload.layersApplied ?? compactResult.layersApplied,
        });
        if (memoryContent) {
          const summaryPreview = payload.summaryPreview ?? memoryContent.slice(0, 420);
          saveThreadMemory({
            threadId: thread.id,
            workspaceId: workspace.id,
            summaryId: payload.summaryId,
            memoryContent,
            round: payload.round,
            method: payload.method,
            updatedAt: nowIso(),
            lastTaskId: task.id,
            lastUserRequest: effectiveUserRequest,
            title: thread.title,
            summaryPreview,
          });
          thread.contextSummary = summaryPreview;
          updateTraceThread(trace.id, {
            contextSummary: summaryPreview,
            updatedAt: nowIso(),
          });
        }
      }
    }

    if (input.signal?.aborted) {
      return finishLoopCancelled({ trace, thread, task, turn, events, emit });
    }

    let output: ModelOutput | undefined;
    let modelRetryAfterCompact = false;
    do {
      modelRetryAfterCompact = false;
      try {
        const loopModel =
          input.model ??
          (agentMessagesHaveImages(messages)
            ? getApiConfig()?.visionModel
            : undefined);

        const forceFinalIteration = shouldForceFinalIteration(
          iteration,
          maxIterations,
          runState,
        );
        const nativeTools = isNativeToolLoopEnabled() && !forceFinalIteration;

        output = await generateLoopModelWithProgress(
          provider,
          {
            messages,
            model: loopModel,
            temperature: 0,
            maxTokens: agentMessagesHaveImages(messages) ? 2000 : 1400,
            metadata: {
              taskId: task.id,
              iteration,
              forceFinal: forceFinalIteration,
            },
            ...(nativeTools
              ? {
                  tools: buildLoopToolDefinitions(),
                  toolChoice: "auto" as const,
                }
              : forceFinalIteration
                ? { toolChoice: "none" as const }
                : {}),
          },
          emit,
          task.id,
        );
      } catch (error) {
        if (
          !reactiveCompactUsed &&
          isContextOverflowError(error) &&
          messages.length > 4
        ) {
          reactiveCompactUsed = true;
          const reactiveCompact = await compactAgentLoopMessages({
            messages,
            userRequest: effectiveUserRequest,
            provider,
            enableSemanticCompact: isSemanticCompactEnabled(),
            compactRound: contextCompactRound + 1,
            filesReadPaths: runState.filesRead,
            prepareHint:
              runState.prepareHint && !runState.approvalPrepared
                ? runState.prepareHint
                : undefined,
            taskReasoning: taskReasoningPinFromRunState(runState.taskReasoning),
            forceCompact: true,
          });
          if (shouldApplyCompactionMessages(reactiveCompact)) {
            messages.length = 0;
            messages.push(...reactiveCompact.messages);
          }
          if (reactiveCompact.method !== "none") {
            contextCompactRound = reactiveCompact.round;
            const payload = createLoopCompactEventPayload(reactiveCompact);
            if (payload) {
              emit({
                type: "context.compacted",
                taskId: task.id,
                summaryId: payload.summaryId,
                method: payload.method,
                estimatedTokensBefore: payload.estimatedTokensBefore,
                estimatedTokensAfter: payload.estimatedTokensAfter,
                round: payload.round,
                middleMessageCount: payload.middleMessageCount,
                summaryPreview: payload.summaryPreview,
                memoryContent: payload.memoryContent,
                threadId: thread.id,
                pinnedApprovalCount: payload.pinnedApprovalCount,
                changedFileCount: payload.changedFileCount,
                layersApplied: payload.layersApplied ?? reactiveCompact.layersApplied,
              });
            }
            modelRetryAfterCompact = true;
            continue;
          }
        }

        modelUnavailable = true;
        const modelError = formatModelErrorMessage(error);
        summary = formatModelFailureSummary(error);
        emitReflection(emit, task.id, {
          understanding: "模型调用失败，任务已暂停。",
          blockers: [modelError],
          plannedNext: "请检查 API 配置或网络后重试；推理已完成时可重发同一问题。",
          source: "runtime",
        });
        emitPlan({ lastAction: "reflect" });
        break;
      }
    } while (modelRetryAfterCompact);

    if (input.signal?.aborted) {
      return finishLoopCancelled({ trace, thread, task, turn, events, emit });
    }

    if (modelUnavailable) {
      if (isDeterministicRecoveryEnabled()) {
        const deterministic = await attemptDeterministicModelFailureRecovery({
          workspace,
          userRequest: effectiveUserRequest,
          runState,
        });
        if (deterministic) {
          summary = deterministic.summary;
          emitReflection(emit, task.id, {
            understanding: deterministic.recovered
              ? "模型不可用，已用确定性路径完成部分目标。"
              : "模型不可用，已输出环境诊断与建议。",
            blockers: deterministic.recovered ? [] : ["模型 API 暂不可用"],
            plannedNext: deterministic.recovered
              ? "可在 API 恢复后继续对话，或直接使用已保存的截图/诊断结果。"
              : "请检查 API 配置或配额后重试。",
            source: "runtime",
          });
        }
      }
      break;
    }
    if (!output) {
      summary = "Model call returned no output.";
      break;
    }

    if (isNativeToolLoopEnabled() && output.toolCalls && output.toolCalls.length > 0) {
      if (shouldForceFinalIteration(iteration, maxIterations, runState)) {
        const forcedText = output.content?.trim();
        if (forcedText) {
          summary = forcedText;
          emitPlan({ lastAction: "final" });
          break;
        }
        continue;
      }

      messages.push({
        role: "assistant",
        content: output.content || null,
        tool_calls: output.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      });

      const preparedCalls = output.toolCalls.map((toolCall) => {
        let args: Record<string, unknown> = {};
        try {
          args = parseToolCallArguments(toolCall.arguments);
        } catch (error) {
          args = {};
          recordToolCall(
            runState,
            toolCall.name,
            { error: fallbackSummary(error) },
            fallbackSummary(error),
          );
        }
        const patchTextFallback =
          toolCall.name === "patch.apply" && typeof args.patch === "string"
            ? args.patch
            : undefined;
        return { toolCall, args, patchTextFallback };
      });

      const runPrepared = async (item: (typeof preparedCalls)[number]) =>
        runAgentLoopToolCall({
          toolName: item.toolCall.name,
          args: item.args,
          patchTextFallback: item.patchTextFallback,
          toolCallId: item.toolCall.id,
          deps: toolRunnerDeps,
        });

      const useParallel = canParallelizeGatherBatch(
        preparedCalls.map((item) => ({
          name: item.toolCall.name,
          args: item.args,
        })),
      );

      if (useParallel) {
        const results = await Promise.all(preparedCalls.map(runPrepared));
        let pendingShell: PendingShellApproval | null = null;
        for (let index = 0; index < results.length; index += 1) {
          const item = preparedCalls[index]!;
          const runResult = results[index]!;
          toolContext = runResult.toolContext;
          messages.push({
            role: "tool",
            tool_call_id: item.toolCall.id,
            content: runResult.observationText,
          });
          const maybePending = pendingShellFromToolRun(
            item.toolCall.name,
            item.toolCall.id,
            runResult,
          );
          if (maybePending) pendingShell = maybePending;
        }
        if (pendingShell && isShellLoopResumeEnabled()) {
          saveShellPauseAndCheckpoint(
            emit,
            {
              threadId: thread.id,
              taskId: task.id,
              savedAt: nowIso(),
              iteration,
              maxIterations,
              effectiveUserRequest,
              messages: [...messages],
              runState: { ...runState },
              pendingShell,
              uiContext: input.uiContext,
            },
            trace.id,
          );
          pausedForShellApproval = true;
          pausedShellApprovalId = pendingShell.approvalId;
          break;
        }
        flushDeferredPostToolTurnMessages(messages, deferredPostToolTurnMessages);
      } else {
        let pendingShell: PendingShellApproval | null = null;
        for (const item of preparedCalls) {
          const runResult = await runPrepared(item);
          toolContext = runResult.toolContext;
          messages.push({
            role: "tool",
            tool_call_id: item.toolCall.id,
            content: runResult.observationText,
          });
          const maybePending = pendingShellFromToolRun(
            item.toolCall.name,
            item.toolCall.id,
            runResult,
          );
          if (maybePending) pendingShell = maybePending;
        }
        if (pendingShell && isShellLoopResumeEnabled()) {
          saveShellPauseAndCheckpoint(
            emit,
            {
              threadId: thread.id,
              taskId: task.id,
              savedAt: nowIso(),
              iteration,
              maxIterations,
              effectiveUserRequest,
              messages: [...messages],
              runState: { ...runState },
              pendingShell,
              uiContext: input.uiContext,
            },
            trace.id,
          );
          pausedForShellApproval = true;
          pausedShellApprovalId = pendingShell.approvalId;
          break;
        }
        flushDeferredPostToolTurnMessages(messages, deferredPostToolTurnMessages);
      }
      continue;
    }

    if (isNativeToolLoopEnabled()) {
      const finalText = output.content?.trim();
      if (!finalText) {
        summary = "Model returned empty response without tool calls.";
        break;
      }

      if (shouldRejectTextOnlyFinal(runState, iteration, maxIterations)) {
        runState.reflectionRounds += 1;
        const reflection: AgentReflection = {
          understanding: finalText,
          blockers: ["改码任务尚未落盘，不能以纯文字结束。"],
          plannedNext:
            "请调用 file.mutation / file.replace / patch.apply 或 shell.run.prepare 完成写盘后再总结。",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
        const pressure =
          buildEditWritePressureNudge(runState, iteration, maxIterations) ??
          buildEditWriteTailNudge(iteration, maxIterations);
        messages.push({ role: "assistant", content: finalText });
        messages.push({ role: "user", content: pressure });
        emitPlan({ lastAction: "reflect" });
        continue;
      }

      summary = finalText;
      emitPlan({ lastAction: "final" });
      break;
    }

    let decision: AgentLoopDecision;
    try {
      decision = parseDecision(output.content);
    } catch (error) {
      summary = `Agent loop stopped because the model did not return valid JSON: ${fallbackSummary(error)}`;
      break;
    }

    messages.push({
      role: "assistant",
      content: output.content,
    });

    if (decision.action === "reflect") {
      runState.reflectionRounds += 1;
      const reflection: AgentReflection = {
        understanding: decision.understanding,
        blockers: decision.blockers ?? [],
        plannedNext: decision.plannedNext,
        source: "model",
      };
      emitReflection(emit, task.id, reflection);
      pushReflectionToMessages(
        messages,
        reflection,
        buildRuntimeCheckpoint(runState),
      );
      emitPlan({ lastAction: "reflect" });
      continue;
    }

    if (decision.action === "final") {
      if (shouldRejectTextOnlyFinal(runState, iteration, maxIterations)) {
        runState.reflectionRounds += 1;
        const reflection: AgentReflection = {
          understanding: decision.summary,
          blockers: ["改码任务尚未落盘，不能以纯文字结束。"],
          plannedNext:
            "请调用 file.mutation / file.replace / patch.apply 或 shell.run.prepare 完成写盘后再总结。",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
        const pressure =
          buildEditWritePressureNudge(runState, iteration, maxIterations) ??
          buildEditWriteTailNudge(iteration, maxIterations);
        messages.push({ role: "user", content: pressure });
        emitPlan({ lastAction: "reflect" });
        continue;
      }
      summary = decision.summary;
      emitPlan({ lastAction: "final" });
      break;
    }

    const runResult = await runAgentLoopToolCall({
      toolName: decision.tool,
      args: decision.args ?? {},
      rationale: decision.thought,
      patchTextFallback:
        typeof decision.args?.patch === "string" ? decision.args.patch : undefined,
      deps: toolRunnerDeps,
    });
    toolContext = runResult.toolContext;
    messages.push(runResult.observationMessage);
    flushDeferredPostToolTurnMessages(messages, deferredPostToolTurnMessages);
    const jsonPendingShell = pendingShellFromToolRun(
      decision.tool,
      `json_${decision.tool}_${iteration}`,
      runResult,
    );
    if (jsonPendingShell && isShellLoopResumeEnabled()) {
      saveShellPauseAndCheckpoint(
        emit,
        {
          threadId: thread.id,
          taskId: task.id,
          savedAt: nowIso(),
          iteration,
          maxIterations,
          effectiveUserRequest,
          messages: [...messages],
          runState: { ...runState },
          pendingShell: jsonPendingShell,
          uiContext: input.uiContext,
        },
        trace.id,
      );
      pausedForShellApproval = true;
      pausedShellApprovalId = jsonPendingShell.approvalId;
      break;
    }
    continue;
  }

  if (input.signal?.aborted) {
    return finishLoopCancelled({ trace, thread, task, turn, events, emit });
  }

  if (pausedForShellApproval && pausedShellApprovalId) {
    const waitingTask: Task = {
      ...task,
      status: "waiting_for_approval",
      updatedAt: nowIso(),
    };
    emit({
      type: "task.awaiting_approval",
      taskId: task.id,
      threadId: thread.id,
      approvalId: pausedShellApprovalId,
      task: waitingTask,
    });
    return {
      traceId: trace.id,
      thread: { ...thread, status: "running", updatedAt: nowIso() },
      task: waitingTask,
      turn: { ...turn, status: "running", updatedAt: nowIso() },
      events,
      summary: "等待用户批准 shell 命令…",
    };
  }

  if (summary === GRACEFUL_FINAL_DEFAULT_SUMMARY) {
    if (!shouldSkipTextOnlyGracefulFinal(runState)) {
      const loopModel =
        input.model ??
        (agentMessagesHaveImages(messages)
          ? getApiConfig()?.visionModel
          : undefined);
      const graceful = await attemptGracefulLoopFinal({
        messages,
        provider,
        taskId: task.id,
        model: loopModel,
        userRequest: effectiveUserRequest,
      });
      if (graceful) {
        summary = graceful;
        emit({ type: "model.delta", taskId: task.id, text: graceful });
        emitPlan({ lastAction: "final" });
      }
    } else {
      summary = buildEditIncompleteGracefulHint();
      emit({ type: "model.delta", taskId: task.id, text: summary });
      emitPlan({ lastAction: "final" });
    }
  }

  if (
    !modelUnavailable &&
    !isEditTaskSatisfied(runState) &&
    isFinalPrepareNudgeEnabled() &&
    shouldRunFinalPrepareNudge(runState, input.uiContext)
  ) {
    const nudgeMessage = buildFinalPrepareNudgeUserMessage(runState);
    if (nudgeMessage) {
      emitReflection(emit, task.id, {
        understanding: "主循环已结束但未生成审批；启动末轮 prepare 助推（A087）。",
        blockers: ["须在 Candidate 原文基础上调用 file.replace.prepare。"],
        plannedNext: `仅允许对 ${runState.prepareHint?.path} 调用 file.replace.prepare。`,
        source: "runtime",
      });
      messages.push({ role: "user", content: nudgeMessage });
      try {
        const loopModel =
          input.model ??
          (agentMessagesHaveImages(messages)
            ? getApiConfig()?.visionModel
            : undefined);
        const output = await provider.generate({
          messages,
          model: loopModel,
          temperature: 0,
          maxTokens: 1200,
          metadata: { taskId: task.id, finalPrepareNudge: true },
        });
        emit({ type: "model.delta", taskId: task.id, text: output.content });
        messages.push({ role: "assistant", content: output.content });
        const decision = parseDecision(output.content);
        if (decision.action === "tool_call" && decision.tool && isPrepareToolName(decision.tool)) {
          const runResult = await runAgentLoopToolCall({
            toolName: decision.tool,
            args: decision.args ?? {},
            rationale: decision.thought ?? "Final prepare nudge",
            deps: toolRunnerDeps,
          });
          toolContext = runResult.toolContext;
          messages.push(runResult.observationMessage);
          if (isEditTaskSatisfied(runState)) {
            summary = "末轮 prepare 助推已完成。";
          }
        }
      } catch {
        // 末轮失败则交给 recovery / 总结
      }
      emitPlan({ lastAction: "tool" });
    }
  }

  const recoverySummary = isEditRecoveryEnabled()
    ? await attemptEditRecovery(
        emit,
        task.id,
        runState,
        workspace.rootPath,
        input.uiContext,
      )
    : null;
  if (recoverySummary) {
    summary = runState.approvalPrepared
      ? recoverySummary
      : `${summary}\n${recoverySummary}`;
  } else if (
    runState.likelyEditRequest &&
    !isExplicitReadOnlyRequest(runState.userRequest) &&
    !isEditTaskSatisfied(runState)
  ) {
    if (shouldSkipEditRecoveryForUiPrepare(runState, input.uiContext)) {
      summary = `${summary}\n已读完推荐 UI 文件并有 exact 行候选，但尚未写盘。请重试并用 file.replace（Candidate 作 search）。`;
    } else {
      summary = `${summary}\n未能完成写盘。请查看事件流或补充更具体的目标文件/确切文字后重试。`;
    }
  } else if (modelUnavailable && !isEditTaskSatisfied(runState)) {
    summary = `${summary}\n模型不可用且磁盘恢复未生成审批。请检查 API 配额或 .env.local 配置后重试。`;
  }

  Object.assign(plan, completedAgentLoopPlan(plan));
  emit({ type: "plan.updated", taskId: task.id, plan: { ...plan } });

  const completedTask: Task = {
    ...task,
    status: "completed",
    plan,
    updatedAt: nowIso(),
    completedAt: nowIso(),
  };
  const completedTurn: Turn = {
    ...turn,
    status: "completed",
    updatedAt: nowIso(),
    summary,
  };

  const existingMemory = getThreadMemory(thread.id);
  const taskMemory = buildThreadMemoryAfterTask({
    messages,
    userRequest: effectiveUserRequest,
    summary,
    priorMemoryContent:
      existingMemory?.memoryContent ?? priorThreadMemory?.memoryContent,
    filesReadPaths: runState.filesRead,
    prepareHint:
      runState.prepareHint && !runState.approvalPrepared
        ? runState.prepareHint
        : undefined,
    compactRound: contextCompactRound,
    taskReasoning: taskReasoningPinFromRunState(runState.taskReasoning),
  });
  saveThreadMemory({
    threadId: thread.id,
    workspaceId: workspace.id,
    summaryId: taskMemory.summaryId,
    memoryContent: taskMemory.memoryContent,
    round: taskMemory.round,
    method: taskMemory.method,
    updatedAt: nowIso(),
    lastTaskId: task.id,
    lastUserRequest: effectiveUserRequest,
    title: thread.title,
    summaryPreview: taskMemory.summaryPreview,
  });
  thread.contextSummary = taskMemory.summaryPreview;
  updateTraceThread(trace.id, {
    contextSummary: taskMemory.summaryPreview,
    updatedAt: nowIso(),
  });

  const latestMemory = getThreadMemory(thread.id);
  const completedThread: Thread = {
    ...thread,
    status: "completed",
    updatedAt: nowIso(),
    summary,
    contextSummary:
      latestMemory?.memoryContent.slice(0, 500) ?? thread.contextSummary,
  };

  emit(
    buildTraceCheckpointEvent({
      taskId: task.id,
      traceId: trace.id,
      checkpoint: {
        kind: "task_completed",
        label: "",
        eventCount: events.length + 1,
      },
    }),
  );
  emit({
    type: "task.completed",
    taskId: task.id,
    task: completedTask,
    summary,
  });

  return {
    traceId: trace.id,
    thread: completedThread,
    task: completedTask,
    turn: completedTurn,
    events,
    summary,
  };
}

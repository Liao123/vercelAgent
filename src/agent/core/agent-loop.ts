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
  shouldSkipEditRecoveryForUiPrepare,
} from "@/agent/core/ui-prepare-nudge";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";
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
import {
  buildLoopToolDefinitions,
  parseToolCallArguments,
} from "@/agent/model/loop-tool-schemas";
import {
  runAgentLoopToolCall,
  shouldInterceptNativeFinal,
  type AgentLoopToolRunnerDeps,
} from "@/agent/core/agent-loop-tool-runner";
import type { AgentUiContext } from "@/agent/types";

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

const DEFAULT_MAX_ITERATIONS = 12;
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

function fallbackSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function pushReflectionToMessages(
  messages: AgentMessage[],
  reflection: AgentReflection,
  checkpoint?: string,
): void {
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

  messages.push({
    role: "user",
    content: parts.join("\n"),
  });
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

export async function runAgentLoop(
  input: AgentLoopInput,
  provider: ModelProvider | null = createConfiguredModelProvider(),
): Promise<AgentLoopResult> {
  if (!provider) {
    throw new Error("No model provider is configured.");
  }

  const now = nowIso();
  const workspace = await getCurrentWorkspace();
  const { cleanRequest, attachedPaths: parsedAttachedPaths, attachedSelections: parsedSelections } =
    parseAtPathsFromRequest(input.userRequest);
  const effectiveUserRequest = cleanRequest || input.userRequest;
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
    id: newId("task"),
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
  const runState = createAgentLoopRunState(effectiveUserRequest);
  if (input.strictPrepare) {
    runState.strictPrepare = true;
  }
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
  emit({ type: "thread.created", threadId: thread.id, thread });
  emit({ type: "task.created", taskId: task.id, task });
  emit({ type: "trace.linked", taskId: task.id, traceId: trace.id });
  emit({ type: "turn.created", turnId: turn.id, turn });
  emitPlan();

  const openingReflection: AgentReflection = {
    understanding: effectiveUserRequest,
    blockers: postExecuteFeedback
      ? [postExecuteFeedback.summary]
      : [],
    plannedNext: postExecuteFeedback
      ? "先读 checkpoint 中 post-execute 失败摘要，修复相关文件后再 file.replace.prepare。"
      : attachedPaths.length > 0
        ? `已预读 ${attachedPaths.length} 个附加文件；继续核实其他假设后再决定是否准备变更审批。`
        : "先用工具在磁盘上核实假设，再决定是否准备代码变更审批。",
    source: "runtime",
  };
  emitReflection(emit, task.id, openingReflection);
  emitPlan();

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: createLoopSystemPrompt(workspace.rootPath, input.uiContext),
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
  pushReflectionToMessages(messages, openingReflection, buildRuntimeCheckpoint(runState));

  let toolContext: AgentLoopToolContext = {
    workspace,
    taskId: task.id,
    uiContext: input.uiContext,
    runState,
  };

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
    pushReflectionToMessages: (reflection, checkpoint) =>
      pushReflectionToMessages(messages, reflection, checkpoint),
    shouldInjectRuntimeReflection,
    emitPlan,
    fallbackSummary,
  };

  let summary = "Agent loop stopped without a final answer.";
  const maxIterations = Math.min(
    Math.max(input.maxIterations ?? DEFAULT_MAX_ITERATIONS, 1),
    16,
  );

  let modelUnavailable = false;
  let contextCompactRound = 0;
  let reactiveCompactUsed = false;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
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

    let output;
    let modelRetryAfterCompact = false;
    do {
      modelRetryAfterCompact = false;
      try {
        const loopModel =
          input.model ??
          (agentMessagesHaveImages(messages)
            ? getApiConfig()?.visionModel
            : undefined);

        output = await provider.generate({
          messages,
          model: loopModel,
          temperature: 0,
          maxTokens: agentMessagesHaveImages(messages) ? 2000 : 1400,
          metadata: { taskId: task.id, iteration },
          ...(isNativeToolLoopEnabled()
            ? {
                tools: buildLoopToolDefinitions(),
                toolChoice: "auto" as const,
              }
            : {}),
        });
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
        summary = `Model call failed: ${fallbackSummary(error)}`;
        emitReflection(emit, task.id, {
          understanding: runState.userRequest,
          blockers: [summary],
          plannedNext: "运行时将在无模型情况下尝试磁盘恢复。",
          source: "runtime",
        });
        emitPlan({ lastAction: "reflect" });
        break;
      }
    } while (modelRetryAfterCompact);

    if (modelUnavailable) break;
    emit({
      type: "model.delta",
      taskId: task.id,
      text: output.content || (output.toolCalls?.length ? `[tools: ${output.toolCalls.map((t) => t.name).join(", ")}]` : ""),
    });

    if (isNativeToolLoopEnabled() && output.toolCalls && output.toolCalls.length > 0) {
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

      for (const toolCall of output.toolCalls) {
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

        const runResult = await runAgentLoopToolCall({
          toolName: toolCall.name,
          args,
          patchTextFallback,
          toolCallId: toolCall.id,
          deps: toolRunnerDeps,
        });
        toolContext = runResult.toolContext;

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: runResult.observationText,
        });
      }
      continue;
    }

    if (isNativeToolLoopEnabled()) {
      const finalText = output.content?.trim();
      if (!finalText) {
        summary = "Model returned empty response without tool calls.";
        break;
      }

      if (shouldInterceptNativeFinal(runState, iteration, maxIterations)) {
        runState.reflectionRounds += 1;
        const reflection: AgentReflection = {
          understanding: finalText,
          blockers: ["改代码任务尚未写盘。"],
          plannedNext:
            "继续调用 file.read 取证，再用 file.replace / patch.apply 写盘。",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
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

    if (
      decision.action === "final" &&
      runState.likelyEditRequest &&
      !isExplicitReadOnlyRequest(runState.userRequest) &&
      !isEditTaskSatisfied(runState) &&
      runState.reflectionRounds < MAX_REFLECTION_ROUNDS &&
      iteration < maxIterations
    ) {
      runState.reflectionRounds += 1;
      const reflection: AgentReflection = {
        understanding: decision.summary,
        blockers: ["改代码任务尚未写盘。"],
        plannedNext:
          "依次调用 file.locate / file.read，再用 file.replace 写盘。",
        source: "runtime",
      };
      emitReflection(emit, task.id, reflection);
      pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
      emitPlan({ lastAction: "reflect" });
      continue;
    }

    if (decision.action === "final") {
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
    continue;
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
  const latestMemory = getThreadMemory(thread.id);
  const completedThread: Thread = {
    ...thread,
    status: "completed",
    updatedAt: nowIso(),
    summary,
    contextSummary:
      latestMemory?.memoryContent.slice(0, 500) ?? thread.contextSummary,
  };

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

/**
 * 模型驱动 Agent Loop（理解 → 取证 → 行动 → 反思）。
 *
 * 通用编程能力：不依赖中文句式硬编码；通过工具观察 + 显式反思检查点推进任务。
 */
import {
  AGENT_LOOP_TOOLS,
  getAgentLoopTool,
  type AgentLoopToolContext,
} from "@/agent/core/agent-loop-tools";
import { tryRecoverEditApproval } from "@/agent/core/edit-recovery";
import {
  buildFinalPrepareNudgeUserMessage,
  isPrepareToolName,
  shouldRunFinalPrepareNudge,
} from "@/agent/core/final-prepare-nudge";
import {
  captureUiPrepareHintFromFileRead,
  listUnreadDisambiguationPaths,
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
} from "@/agent/memory/loop-context-compactor";
import {
  buildThreadMemoryInjectionMessage,
  getThreadMemory,
  saveThreadMemory,
} from "@/agent/memory/thread-memory-store";
import { getCurrentWorkspace } from "@/agent/workspace";
import { describeUiContextForPrompt } from "@/agent/indexer/ui-layout-boost";
import {
  formatAttachedFilesUserNote,
  mergeAttachedPaths,
  mergeAttachedSelections,
  parseAtPathsFromRequest,
  preloadAttachedFiles,
  type EditorSelectionContext,
} from "@/agent/core/attached-files";
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

function createSystemPrompt(
  workspaceRoot: string,
  uiContext?: AgentUiContext,
): string {
  const toolList = AGENT_LOOP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    args: tool.args,
  }));

  return [
    "You are a coding agent runtime controller in a reflective loop.",
    "Workflow: UNDERSTAND → GATHER EVIDENCE (tools) → PREPARE CHANGE → REFLECT → repeat until done.",
    "User-facing text in reflect (understanding, plannedNext, blockers) and final summary MUST be Simplified Chinese.",
    "You must respond with one JSON object and no markdown.",
    "Allowed response shapes:",
    '{"action":"reflect","understanding":"用户想要什么（中文）","blockers":["可选阻塞（中文）"],"plannedNext":"下一步具体动作（中文）","thought":"optional"}',
    '{"action":"tool_call","tool":"tool.name","args":{},"thought":"为什么要调用这个工具（中文，一句话）"}',
    '{"action":"final","summary":"给用户的中文总结","thought":"optional"}',
    "Always include thought on tool_call: one Chinese sentence explaining why you are calling the tool and what you expect to learn.",
    "Use action=reflect when you need to think before the next tool, or after a failure, or when the request is ambiguous.",
    "Only call tools from the provided list. Do not invent tools.",
    "For code-change requests:",
    "- Gather evidence first: project.index, file.locate, file.read, file.search as needed.",
    "- UI / 首页 / 页面 / 按钮 / 去掉某段界面文字:",
    "  1) Call ui.trace_from_page (or file.locate—the latter merges import tree for UI queries) BEFORE file.search.",
    "  2) Use jsx.find_text for visible labels (闭环/Loop/buttons)—returns line numbers + component guess; prefer over raw file.search.",
    "  3) Use symbol.find_references when you need who imports a component file or where a symbol is exported.",
    "  4) file.read files in suggestedReadOrder until you find the exact JSX with the visible label.",
    "  5) Do NOT edit src/agent/core/* just because file.search found loop/闭环—prefer src/app/* and src/components/* for user-visible UI.",
    "  6) If multiple files contain the same label, file.read EACH candidate (see disambiguation.mustReadPaths from locate/trace) before prepare; in reflect explain why you chose the recommended file.",
    "  7) Before file.replace.prepare, file.read EVERY file you will edit and confirm the exact visible label text exists there.",
    "- Never guess file.replace.prepare search text from loose Chinese (e.g. 删除首页123文字). Read the file and copy an exact substring from disk.",
    "- Small edits: file.replace.prepare. Single-file full replace: file.mutation.prepare. Multi-file or /dev/null diffs: patch.prepare.",
    "- Mutation prepare tools only create approvals; the user approves and executes in the UI.",
    "- Do not action=final on edit tasks until an approval was prepared, unless you explain clearly why it is impossible.",
    "- To verify: shell.command.prepare with lint, build, test, or typecheck (only if script exists in package.json).",
    "- After user executes a file/patch approval, runtime may auto-run lint/typecheck; failures appear as verification.completed events—fix in a new Loop round, never auto-apply.",
    "- User may attach files via @path in the request or UI; pre-loaded file.read at task start counts as read evidence.",
    "- Git branch/commit/push: git.mutation.prepare only; never assume they ran.",
    "On tool errors: action=reflect, then try a different strategy (another path, file.search, different exact search string).",
    "Do not run arbitrary shell, install packages, or auto-execute git/shell without user approval in the UI.",
    `Workspace root: ${workspaceRoot}`,
    describeUiContextForPrompt(uiContext),
    `Tools: ${JSON.stringify(toolList)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

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

function observationMessage(toolName: string, result: unknown): AgentMessage {
  return buildToolObservationMessage(toolName, result);
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
  if (state.likelyEditRequest && !state.approvalPrepared && state.toolsCalled.length >= 2) {
    return true;
  }
  if (state.prepareHint && !state.approvalPrepared) {
    return true;
  }
  if (listUnreadDisambiguationPaths(state).length > 0) {
    return true;
  }
  if (state.postExecuteFeedback && !state.approvalPrepared) {
    return true;
  }
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
  const task: Task = {
    id: newId("task"),
    threadId: thread.id,
    workspaceId: workspace.id,
    userRequest: effectiveUserRequest,
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
      content: createSystemPrompt(workspace.rootPath, input.uiContext),
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
      input.referenceImages,
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
      messages.push(observationMessage("file.read", result));
    }
  }
  pushReflectionToMessages(messages, openingReflection, buildRuntimeCheckpoint(runState));

  let toolContext: AgentLoopToolContext = {
    workspace,
    taskId: task.id,
    uiContext: input.uiContext,
    runState,
  };
  let summary = "Agent loop stopped without a final answer.";
  const maxIterations = Math.min(
    Math.max(input.maxIterations ?? DEFAULT_MAX_ITERATIONS, 1),
    16,
  );

  let modelUnavailable = false;
  let contextCompactRound = 0;

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
    if (compactResult.method !== "none") {
      contextCompactRound = compactResult.round;
      messages.length = 0;
      messages.push(...compactResult.messages);
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
      });
    } catch (error) {
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
    emit({
      type: "model.delta",
      taskId: task.id,
      text: output.content,
    });

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
      !runState.approvalPrepared &&
      runState.reflectionRounds < MAX_REFLECTION_ROUNDS &&
      iteration < maxIterations
    ) {
      runState.reflectionRounds += 1;
      const reflection: AgentReflection = {
        understanding: decision.summary,
        blockers: ["改代码任务尚未生成审批。"],
        plannedNext:
          "依次调用 file.locate / file.read / file.search，再用 file.replace.prepare 传入磁盘上的精确子串。",
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

    const tool = getAgentLoopTool(decision.tool);
    if (!tool) {
      const observation = {
        error: `Tool is not allowed: ${decision.tool}`,
        allowedTools: AGENT_LOOP_TOOLS.map((item) => item.name),
      };
      recordToolCall(runState, "tool.error", observation, observation.error);
      messages.push(observationMessage("tool.error", observation));
      if (shouldInjectRuntimeReflection(runState)) {
        runState.reflectionRounds += 1;
        const reflection: AgentReflection = {
          understanding: "上一次工具选择无效。",
          blockers: [observation.error],
          plannedNext: "从允许的工具列表中重新选择。",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
        emitPlan({ lastAction: "reflect" });
      }
      continue;
    }

    const toolCall = createToolCall(
      task.id,
      tool.name,
      decision.args ?? {},
      decision.thought,
    );
    emit({ type: "tool.started", taskId: task.id, toolCall });
    try {
      const toolResult = await tool.execute(decision.args ?? {}, toolContext);
      if (toolResult.context) toolContext = toolResult.context;
      emit({
        type: "tool.completed",
        taskId: task.id,
        toolCall: completeToolCall(toolCall),
        result: toolResult.result,
      });
      recordToolCall(runState, tool.name, toolResult.result);

      if (tool.name === "file.read" && toolResult.result && typeof toolResult.result === "object") {
        const readResult = toolResult.result as { path?: unknown; content?: unknown };
        if (
          typeof readResult.path === "string" &&
          typeof readResult.content === "string"
        ) {
          captureUiPrepareHintFromFileRead(
            runState,
            readResult.path,
            readResult.content,
            toolContext.uiContext,
          );
        }
      }

      const approval = extractApprovalFromToolResult(toolResult.result);
      if (approval) {
        runState.approvalPrepared = true;
        if (runState.postExecuteFeedback) {
          delete runState.postExecuteFeedback;
        }
        emit({
          type: "approval.required",
          taskId: task.id,
          approval,
        });
      }

      messages.push(observationMessage(tool.name, toolResult.result));

      if (shouldInjectRuntimeReflection(runState)) {
        runState.reflectionRounds += 1;
        const pendingLintFix =
          Boolean(runState.postExecuteFeedback) && !runState.approvalPrepared;
        const reflection: AgentReflection = {
          understanding: runState.approvalPrepared
            ? "已生成代码变更审批，等待界面接受并写盘（写盘后会自动跑 lint/typecheck）。"
            : pendingLintFix
              ? "上一轮写盘后 lint/typecheck 未通过，需用 file.replace.prepare 提交修复审批，不要只反复 file.read。"
              : "工具已运行，但改代码审批仍未就绪或上一步失败。",
          blockers: [
            ...(runState.postExecuteFeedback
              ? [runState.postExecuteFeedback.summary]
              : []),
            ...(runState.lastPrepareError ? [runState.lastPrepareError] : []),
            ...(runState.lastToolError &&
            !runState.lastPrepareError &&
            !runState.postExecuteFeedback
              ? [runState.lastToolError]
              : []),
          ],
          plannedNext: runState.approvalPrepared
            ? "可以 action=final，并提示用户在审查区接受变更。"
            : pendingLintFix
              ? "对 checkpoint 中列出的出错文件：file.read 确认原文 → file.replace.prepare（search 必须为磁盘原文）。"
              : listUnreadDisambiguationPaths(runState).length > 0
                ? `先 file.read 未读候选：${listUnreadDisambiguationPaths(runState).join("、")}，再 prepare。`
                : runState.prepareHint
                  ? `立即对 ${runState.prepareHint.path} 调用 file.replace.prepare；search 必须使用 checkpoint 里 Candidate 的 JSON 字符串原文（含空格）。`
                  : "action=reflect，或 file.read + file.replace.prepare（精确子串）。",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
        emitPlan({ lastAction: "reflect" });
      }
      emitPlan({ lastAction: "tool" });
    } catch (error) {
      const observation = { error: fallbackSummary(error) };
      recordToolCall(runState, tool.name, observation, observation.error);
      emit({
        type: "tool.completed",
        taskId: task.id,
        toolCall: completeToolCall(toolCall, observation.error),
        result: observation,
      });
      messages.push(observationMessage(tool.name, observation));

      runState.reflectionRounds += 1;
      const reflection: AgentReflection = {
        understanding: `工具 ${tool.name} 执行失败。`,
        blockers: [observation.error],
        plannedNext:
          "先反思：尝试 file.search、换路径或其他策略，再重试 prepare。",
        source: "runtime",
      };
      emitReflection(emit, task.id, reflection);
      pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
      emitPlan({ lastAction: "reflect" });
    }
  }

  if (
    !modelUnavailable &&
    !runState.approvalPrepared &&
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
        if (decision.action === "tool_call" && decision.tool) {
          const tool = getAgentLoopTool(decision.tool);
          if (tool && isPrepareToolName(tool.name)) {
            const toolCall = createToolCall(
              task.id,
              tool.name,
              decision.args ?? {},
              decision.thought ?? "Final prepare nudge",
            );
            emit({ type: "tool.started", taskId: task.id, toolCall });
            const toolResult = await tool.execute(decision.args ?? {}, toolContext);
            if (toolResult.context) toolContext = toolResult.context;
            emit({
              type: "tool.completed",
              taskId: task.id,
              toolCall: completeToolCall(toolCall),
              result: toolResult.result,
            });
            recordToolCall(runState, tool.name, toolResult.result);
            const approval = extractApprovalFromToolResult(toolResult.result);
            if (approval) {
              runState.approvalPrepared = true;
              emit({ type: "approval.required", taskId: task.id, approval });
              summary =
                "末轮 prepare 助推已生成审批。请在界面批准并执行。";
            }
            messages.push(observationMessage(tool.name, toolResult.result));
          }
        }
      } catch {
        // 末轮失败则交给 recovery / 总结
      }
      emitPlan({ lastAction: "tool" });
    }
  }

  const recoverySummary = await attemptEditRecovery(
    emit,
    task.id,
    runState,
    workspace.rootPath,
    input.uiContext,
  );
  if (recoverySummary) {
    summary = runState.approvalPrepared
      ? recoverySummary
      : `${summary}\n${recoverySummary}`;
  } else if (
    runState.likelyEditRequest &&
    !isExplicitReadOnlyRequest(runState.userRequest) &&
    !runState.approvalPrepared
  ) {
    if (shouldSkipEditRecoveryForUiPrepare(runState, input.uiContext)) {
      summary = `${summary}\n已读完推荐 UI 文件并有 exact 行候选，但尚未调用 file.replace.prepare。请重试，并使用 checkpoint 中的 Candidate 作为 search 参数（勿依赖 edit.recovery）。`;
    } else {
      summary = `${summary}\n未能为本次改代码需求生成审批。请查看事件流中的反思步骤，或补充更具体的目标文件/要改的确切文字后重试。`;
    }
  } else if (modelUnavailable && !runState.approvalPrepared) {
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

function extractApprovalFromToolResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  if (!("approval" in result)) return null;
  const approval = (result as { approval?: unknown }).approval;
  if (!approval || typeof approval !== "object") return null;
  if (!("id" in approval) || !("action" in approval)) return null;
  return approval as Extract<AgentEvent, { type: "approval.required" }>["approval"];
}

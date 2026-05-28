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
  buildRuntimeCheckpoint,
  createAgentLoopRunState,
  recordToolCall,
  type AgentLoopRunState,
} from "@/agent/core/agent-loop-state";
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
  type AgentPlan,
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

export type AgentLoopInput = {
  userRequest: string;
  /** 参考图 data URL（走 vision 模型） */
  referenceImages?: string[];
  maxIterations?: number;
  model?: string;
  /** 延续已有 Thread，并注入其滚动任务记忆 */
  threadId?: string;
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

function createAgentLoopPlan(input: AgentLoopInput): AgentPlan {
  return {
    goal: input.userRequest,
    steps: [
      {
        id: "understand",
        title: "Clarify user intent and constraints",
        status: "doing",
      },
      {
        id: "gather",
        title: "Locate and read relevant files (evidence from disk)",
        status: "todo",
      },
      {
        id: "prepare",
        title: "Prepare code change approval when needed",
        status: "todo",
      },
      {
        id: "reflect",
        title: "Reflect on progress; adjust strategy if blocked",
        status: "todo",
      },
      {
        id: "finish",
        title: "Summarize outcome for the user",
        status: "todo",
      },
    ],
    risks: [
      "Code edits require an approval record; the runtime will push reflection if you try to finalize too early.",
      "search strings for file.replace.prepare must match file content exactly—never guess from vague Chinese phrasing.",
    ],
    verification: [
      "Edit tasks should end with approval.required or a clear explanation of what blocked progress.",
    ],
    updatedAt: nowIso(),
  };
}

function createSystemPrompt(workspaceRoot: string): string {
  const toolList = AGENT_LOOP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    args: tool.args,
  }));

  return [
    "You are a coding agent runtime controller in a reflective loop.",
    "Workflow: UNDERSTAND → GATHER EVIDENCE (tools) → PREPARE CHANGE → REFLECT → repeat until done.",
    "You must respond with one JSON object and no markdown.",
    "Allowed response shapes:",
    '{"action":"reflect","understanding":"what the user wants","blockers":["optional issues"],"plannedNext":"next concrete step","thought":"optional"}',
    '{"action":"tool_call","tool":"tool.name","args":{},"thought":"short reason"}',
    '{"action":"final","summary":"user-facing answer","thought":"optional"}',
    "Use action=reflect when you need to think before the next tool, or after a failure, or when the request is ambiguous.",
    "Only call tools from the provided list. Do not invent tools.",
    "For code-change requests:",
    "- Gather evidence first: project.index, file.locate, file.read, file.search as needed.",
    "- Never guess file.replace.prepare search text from loose Chinese (e.g. 删除首页123文字). Read the file and copy an exact substring from disk.",
    "- Small edits: file.replace.prepare. Single-file full replace: file.mutation.prepare. Multi-file or /dev/null diffs: patch.prepare.",
    "- Mutation prepare tools only create approvals; the user approves and executes in the UI.",
    "- Do not action=final on edit tasks until an approval was prepared, unless you explain clearly why it is impossible.",
    "- To verify: shell.command.prepare with lint, build, test, or typecheck (only if script exists in package.json).",
    "- Git branch/commit/push: git.mutation.prepare only; never assume they ran.",
    "On tool errors: action=reflect, then try a different strategy (another path, file.search, different exact search string).",
    "Do not run arbitrary shell, install packages, or auto-execute git/shell without user approval in the UI.",
    `Workspace root: ${workspaceRoot}`,
    `Tools: ${JSON.stringify(toolList)}`,
  ].join("\n");
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
): ToolCallRecord {
  return {
    id: newId("tool"),
    taskId,
    toolName,
    args,
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
  emit({ type: "reflection.updated", taskId, reflection });
}

function pushReflectionToMessages(
  messages: AgentMessage[],
  reflection: AgentReflection,
  checkpoint?: string,
): void {
  const parts = [
    checkpoint,
    `Reflection (${reflection.source}):`,
    `Understanding: ${reflection.understanding}`,
    reflection.blockers.length > 0
      ? `Blockers: ${reflection.blockers.join("; ")}`
      : "Blockers: (none)",
    `Planned next: ${reflection.plannedNext}`,
    "Continue with a tool_call or another reflect—do not finalize edit tasks without approval unless impossible.",
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
): Promise<string | null> {
  if (!runState.likelyEditRequest || runState.approvalPrepared) return null;

  const recovery = await tryRecoverEditApproval({
    rootPath,
    taskId,
    userRequest: runState.userRequest,
    filesRead: runState.filesRead,
  });

  if (!recovery) return null;

  if (recovery.ok) {
    runState.approvalPrepared = true;
    emitRecoveryApprovalEvents(emit, taskId, recovery);
    emitReflection(emit, taskId, {
      understanding: `Disk recovery prepared removal of "${recovery.search}" in ${recovery.path}.`,
      blockers: [],
      plannedNext: "User should approve and execute in the UI.",
      source: "runtime",
    });
    return `已通过磁盘证据恢复并生成审批：从 ${recovery.path} 删除「${recovery.search}」。请在审批区点击「批准并执行」。`;
  }

  return recovery.message;
}

function shouldInjectRuntimeReflection(state: AgentLoopRunState): boolean {
  if (state.reflectionRounds >= MAX_REFLECTION_ROUNDS) return false;
  if (state.lastToolError || state.lastPrepareError) return true;
  if (state.likelyEditRequest && !state.approvalPrepared && state.toolsCalled.length >= 2) {
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
    userRequest: input.userRequest,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  const turn: Turn = {
    id: newId("turn"),
    threadId: thread.id,
    taskId: task.id,
    userInput: input.userRequest,
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
  const plan = createAgentLoopPlan(input);
  const events: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
    appendTraceEvent(trace.id, event);
    input.onEvent?.(event);
  };
  emit({ type: "thread.created", threadId: thread.id, thread });
  emit({ type: "task.created", taskId: task.id, task });
  emit({ type: "trace.linked", taskId: task.id, traceId: trace.id });
  emit({ type: "turn.created", turnId: turn.id, turn });
  emit({ type: "plan.updated", taskId: task.id, plan });

  const runState = createAgentLoopRunState(input.userRequest);
  const openingReflection: AgentReflection = {
    understanding: input.userRequest,
    blockers: [],
    plannedNext:
      "Use tools to verify assumptions on disk before preparing any code change.",
    source: "runtime",
  };
  emitReflection(emit, task.id, openingReflection);

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: createSystemPrompt(workspace.rootPath),
    },
  ];
  if (priorThreadMemory?.memoryContent) {
    messages.push(
      buildThreadMemoryInjectionMessage(priorThreadMemory.memoryContent),
    );
  }
  messages.push({
    role: "user",
    content: buildAgentUserContent(
      input.userRequest,
      input.referenceImages,
    ),
  });
  pushReflectionToMessages(messages, openingReflection, buildRuntimeCheckpoint(runState));

  let toolContext: AgentLoopToolContext = { workspace, taskId: task.id };
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
      userRequest: input.userRequest,
      provider,
      enableSemanticCompact: isSemanticCompactEnabled(),
      compactRound: contextCompactRound + 1,
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
            lastUserRequest: input.userRequest,
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
        plannedNext:
          "Runtime will attempt disk-based edit recovery without the model.",
        source: "runtime",
      });
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
      continue;
    }

    if (
      decision.action === "final" &&
      runState.likelyEditRequest &&
      !runState.approvalPrepared &&
      runState.reflectionRounds < MAX_REFLECTION_ROUNDS &&
      iteration < maxIterations
    ) {
      runState.reflectionRounds += 1;
      const reflection: AgentReflection = {
        understanding: decision.summary,
        blockers: ["No approval prepared yet for this edit request."],
        plannedNext:
          "Call file.locate / file.read / file.search, then file.replace.prepare with exact search text from disk.",
        source: "runtime",
      };
      emitReflection(emit, task.id, reflection);
      pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
      continue;
    }

    if (decision.action === "final") {
      summary = decision.summary;
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
          understanding: "Previous tool choice was invalid.",
          blockers: [observation.error],
          plannedNext: "Pick a tool from the allowed list.",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
      }
      continue;
    }

    const toolCall = createToolCall(task.id, tool.name, decision.args ?? {});
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

      const approval = extractApprovalFromToolResult(toolResult.result);
      if (approval) {
        runState.approvalPrepared = true;
        emit({
          type: "approval.required",
          taskId: task.id,
          approval,
        });
      }

      messages.push(observationMessage(tool.name, toolResult.result));

      if (shouldInjectRuntimeReflection(runState)) {
        runState.reflectionRounds += 1;
        const reflection: AgentReflection = {
          understanding: runState.approvalPrepared
            ? "Approval is prepared; user must approve and execute in UI."
            : "Tool ran but edit approval is still missing or last step failed.",
          blockers: [
            ...(runState.lastPrepareError ? [runState.lastPrepareError] : []),
            ...(runState.lastToolError && !runState.lastPrepareError
              ? [runState.lastToolError]
              : []),
          ],
          plannedNext: runState.approvalPrepared
            ? "action=final with instructions for user to approve and execute."
            : "action=reflect or file.read + file.replace.prepare with exact substring.",
          source: "runtime",
        };
        emitReflection(emit, task.id, reflection);
        pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
      }
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
        understanding: `Tool ${tool.name} failed.`,
        blockers: [observation.error],
        plannedNext:
          "Reflect on alternative evidence (file.search, different path) before retrying prepare.",
        source: "runtime",
      };
      emitReflection(emit, task.id, reflection);
      pushReflectionToMessages(messages, reflection, buildRuntimeCheckpoint(runState));
    }
  }

  const recoverySummary = await attemptEditRecovery(
    emit,
    task.id,
    runState,
    workspace.rootPath,
  );
  if (recoverySummary) {
    summary = runState.approvalPrepared
      ? recoverySummary
      : `${summary}\n${recoverySummary}`;
  } else if (runState.likelyEditRequest && !runState.approvalPrepared) {
    summary = `${summary}\n未能为本次改代码需求生成审批。请查看事件流中的反思步骤，或补充更具体的目标文件/要改的确切文字后重试。`;
  } else if (modelUnavailable && !runState.approvalPrepared) {
    summary = `${summary}\n模型不可用且磁盘恢复未生成审批。请检查 API 配额或 .env.local 配置后重试。`;
  }

  const completedTask: Task = {
    ...task,
    status: "completed",
    plan: {
      ...plan,
      steps: plan.steps.map((step) => ({ ...step, status: "done" })),
      updatedAt: nowIso(),
    },
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

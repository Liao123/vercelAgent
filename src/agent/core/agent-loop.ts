/**
 * 模型驱动 Agent Loop。
 *
 * 模型每轮返回 JSON：要么调用一个允许的工具，要么给出最终回答。
 * 当前只开放只读/低风险工具，写操作后续必须接入审批系统。
 */
import {
  AGENT_LOOP_TOOLS,
  getAgentLoopTool,
  type AgentLoopToolContext,
} from "@/agent/core/agent-loop-tools";
import { createConfiguredModelProvider, type ModelProvider } from "@/agent/model";
import { createTrace, appendTraceEvent } from "@/agent/trace/trace-store";
import {
  newId,
  nowIso,
  type AgentEvent,
  type AgentMessage,
  type AgentPlan,
  type Task,
  type Thread,
  type ToolCallRecord,
  type Turn,
} from "@/agent/types";
import { getCurrentWorkspace } from "@/agent/workspace";

export type AgentLoopInput = {
  userRequest: string;
  maxIterations?: number;
  model?: string;
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
      action: "final";
      summary: string;
      thought?: string;
    };

const DEFAULT_MAX_ITERATIONS = 6;

function createAgentLoopPlan(input: AgentLoopInput): AgentPlan {
  return {
    goal: input.userRequest,
    steps: [
      {
        id: "reason",
        title: "Ask the model to choose the next safe tool or final answer",
        status: "doing",
      },
      {
        id: "act",
        title: "Execute approved read-only or low-risk tools",
        status: "todo",
      },
      {
        id: "observe",
        title: "Feed tool observations back into the model",
        status: "todo",
      },
      {
        id: "finish",
        title: "Stop when the model returns a final answer",
        status: "todo",
      },
    ],
    risks: [
      "This loop intentionally does not expose file writes, shell commands, or Git writes yet.",
      "Model output must be valid JSON; invalid responses are converted into a final error summary.",
    ],
    verification: [
      "Loop events should show model deltas, tool calls, observations, and final completion.",
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
    "You are a coding agent runtime controller.",
    "You must respond with one JSON object and no markdown.",
    "Allowed response shapes:",
    '{"action":"tool_call","tool":"tool.name","args":{},"thought":"short reason"}',
    '{"action":"final","summary":"final answer for the user","thought":"short reason"}',
    "Only call tools from the provided list. Do not invent tools.",
    "Prefer using project.index and file.locate before reading specific files.",
    "Do not ask to write files, run shell commands, install packages, or commit git changes in this loop.",
    `Workspace root: ${workspaceRoot}`,
    `Tools: ${JSON.stringify(toolList)}`,
  ].join("\n");
}

function safeJson(value: unknown, maxChars = 24_000): string {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars)}\n...[truncated ${json.length - maxChars} chars]`;
}

function parseDecision(content: string): AgentLoopDecision {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const jsonText = fenced?.[1] ?? trimmed;
  const parsed = JSON.parse(jsonText) as {
    action?: unknown;
    tool?: unknown;
    args?: unknown;
    summary?: unknown;
    thought?: unknown;
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

  if (parsed.action === "final" && typeof parsed.summary === "string") {
    return {
      action: "final",
      summary: parsed.summary,
      thought: typeof parsed.thought === "string" ? parsed.thought : undefined,
    };
  }

  throw new Error("Model returned an unsupported agent loop decision.");
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
  return {
    role: "user",
    content: `Observation from ${toolName}:\n${safeJson(result)}`,
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
  const thread: Thread = {
    id: newId("thread"),
    workspaceId: workspace.id,
    title: input.userRequest.slice(0, 80) || "Agent loop task",
    status: "running",
    createdAt: now,
    updatedAt: now,
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
  emit({ type: "turn.created", turnId: turn.id, turn });
  emit({ type: "plan.updated", taskId: task.id, plan });

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: createSystemPrompt(workspace.rootPath),
    },
    {
      role: "user",
      content: input.userRequest,
    },
  ];
  let toolContext: AgentLoopToolContext = { workspace };
  let summary = "Agent loop stopped without a final answer.";
  const maxIterations = Math.min(
    Math.max(input.maxIterations ?? DEFAULT_MAX_ITERATIONS, 1),
    12,
  );

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const output = await provider.generate({
      messages,
      model: input.model,
      temperature: 0,
      maxTokens: 1200,
      metadata: { taskId: task.id, iteration },
    });
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
      messages.push(observationMessage("tool.error", observation));
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
      messages.push(observationMessage(tool.name, toolResult.result));
    } catch (error) {
      const observation = { error: fallbackSummary(error) };
      emit({
        type: "tool.completed",
        taskId: task.id,
        toolCall: completeToolCall(toolCall, observation.error),
        result: observation,
      });
      messages.push(observationMessage(tool.name, observation));
    }
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
  emit({
    type: "task.completed",
    taskId: task.id,
    task: completedTask,
    summary,
  });

  return {
    traceId: trace.id,
    thread,
    task: completedTask,
    turn: completedTurn,
    events,
    summary,
  };
}

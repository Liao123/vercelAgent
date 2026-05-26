/**
 * Agent Task Runtime 雏形。
 *
 * 这里先创建 Thread / Task / Turn / Plan / Trace / Event 的最小闭环。
 * 真正的模型推理、工具循环、文件修改和验证会在后续工作项中逐步接进来。
 */
import { createTrace, appendTraceEvent } from "@/agent/trace/trace-store";
import {
  applyTokenBudget,
  buildAgentContext,
  compressContext,
  DEFAULT_AGENT_SYSTEM_INSTRUCTIONS,
  DEFAULT_TOKEN_BUDGET,
  shouldCompressContext,
} from "@/agent/memory";
import { getCurrentWorkspace } from "@/agent/workspace";
import {
  newId,
  nowIso,
  type AgentEvent,
  type AgentPlan,
  type Task,
  type Thread,
  type ToolCallRecord,
  type Turn,
} from "@/agent/types";

export type StartTaskInput = {
  userRequest: string;
};

export type StartTaskResult = {
  traceId: string;
  thread: Thread;
  task: Task;
  turn: Turn;
  events: AgentEvent[];
};

function createInitialPlan(userRequest: string): AgentPlan {
  return {
    goal: userRequest,
    steps: [
      {
        id: "step_1",
        title: "Read workspace metadata and project rules",
        status: "done",
      },
      {
        id: "step_2",
        title: "Prepare a task event stream for future agent execution",
        status: "done",
      },
      {
        id: "step_3",
        title: "Wait for the next implementation phase",
        status: "todo",
      },
    ],
    risks: [
      "This is the task runtime skeleton; file edits and shell execution are not enabled yet.",
    ],
    verification: [
      "TypeScript compilation and lint should pass after this skeleton is wired.",
    ],
    updatedAt: nowIso(),
  };
}

export async function startTask(input: StartTaskInput): Promise<StartTaskResult> {
  const now = nowIso();
  const workspace = await getCurrentWorkspace();
  const thread: Thread = {
    id: newId("thread"),
    workspaceId: workspace.id,
    title: input.userRequest.slice(0, 80) || "Untitled task",
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
    status: "completed",
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
  const plan = createInitialPlan(input.userRequest);
  const toolCall: ToolCallRecord = {
    id: newId("tool"),
    taskId: task.id,
    toolName: "workspace.scan",
    args: { rootPath: workspace.rootPath },
    startedAt: now,
    completedAt: nowIso(),
  };
  const completedTask: Task = {
    ...task,
    status: "completed",
    plan,
    updatedAt: nowIso(),
    completedAt: nowIso(),
  };
  const context = buildAgentContext({
    systemInstructions: DEFAULT_AGENT_SYSTEM_INSTRUCTIONS,
    projectRules: workspace.rules,
    thread,
    task: completedTask,
    turn,
  });
  const compressedContext = shouldCompressContext(context.sections, 2000)
    ? compressContext({
        scope: "task",
        sections: context.sections,
      })
    : null;
  const budget = applyTokenBudget(context.sections, DEFAULT_TOKEN_BUDGET);
  const events: AgentEvent[] = [
    { type: "thread.created", threadId: thread.id, thread },
    { type: "task.created", taskId: task.id, task },
    { type: "turn.created", turnId: turn.id, turn },
    { type: "plan.updated", taskId: task.id, plan },
    { type: "tool.started", taskId: task.id, toolCall },
    {
      type: "tool.completed",
      taskId: task.id,
      toolCall,
      result: {
        rootPath: workspace.rootPath,
        gitRootPath: workspace.gitRootPath,
        packageManager: workspace.packageManager,
        framework: workspace.framework,
        context: {
          sectionCount: context.sections.length,
          estimatedTokens: context.estimatedTokens,
          budget: {
            maxInputTokens: budget.config.maxInputTokens,
            reservedOutputTokens: budget.config.reservedOutputTokens,
            maxContextTokens: budget.maxContextTokens,
            estimatedTokens: budget.estimatedTokens,
            overBudget: budget.overBudget,
            shouldCompress: budget.shouldCompress,
            droppedSectionCount: budget.droppedSections.length,
          },
          compressed: compressedContext
            ? {
                summaryId: compressedContext.summary.id,
                estimatedTokensBefore:
                  compressedContext.summary.estimatedTokensBefore,
                estimatedTokensAfter:
                  compressedContext.summary.estimatedTokensAfter,
              }
            : null,
          sections: context.sections.map((section) => ({
            id: section.id,
            kind: section.kind,
            title: section.title,
            estimatedTokens: section.estimatedTokens,
          })),
        },
        rules: workspace.rules.map((rule) => ({
          path: rule.path,
          truncated: rule.truncated,
        })),
      },
    },
    ...(compressedContext
      ? [
          {
            type: "context.compacted" as const,
            taskId: task.id,
            summaryId: compressedContext.summary.id,
          },
        ]
      : []),
    {
      type: "task.completed",
      taskId: task.id,
      task: completedTask,
      summary: "Task runtime skeleton completed. No file edits were attempted.",
    },
  ];

  for (const event of events) {
    appendTraceEvent(trace.id, event);
  }

  return {
    traceId: trace.id,
    thread,
    task: completedTask,
    turn,
    events,
  };
}

/**
 * 最小开发闭环。
 *
 * 串起需求、项目索引、文件定位、可选 patch 预览/应用、验证和总结。
 * 这里还不让模型自动生成 patch，先把工具链的安全闭环跑通。
 */
import { extractFirstOpenableUrl, openBrowserUrl } from "@/agent/browser";
import { buildProjectIndex, locateFilesForRequest } from "@/agent/indexer";
import { applyUnifiedPatch, createPatchApproval } from "@/agent/tools";
import { createTrace, appendTraceEvent } from "@/agent/trace/trace-store";
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
import {
  runVerificationPlan,
  type VerificationCommand,
} from "@/agent/verification";
import { getCurrentWorkspace } from "@/agent/workspace";

export type DevelopmentLoopInput = {
  userRequest: string;
  patch?: string;
  applyPatch?: boolean;
  approvalId?: string;
  verify?: boolean;
  verificationCommands?: VerificationCommand[];
};

export type DevelopmentLoopResult = {
  traceId: string;
  thread: Thread;
  task: Task;
  turn: Turn;
  events: AgentEvent[];
  summary: string;
};

function toolCall(toolName: string, taskId: string, args: unknown): ToolCallRecord {
  return {
    id: newId("tool"),
    taskId,
    toolName,
    args,
    startedAt: nowIso(),
  };
}

function completeToolCall(call: ToolCallRecord): ToolCallRecord {
  return {
    ...call,
    completedAt: nowIso(),
  };
}

function createDevelopmentPlan(input: DevelopmentLoopInput): AgentPlan {
  return {
    goal: input.userRequest,
    steps: [
      {
        id: "locate_files",
        title: "Locate candidate files from the project index",
        status: "todo",
      },
      {
        id: "patch",
        title: input.patch
          ? input.applyPatch
            ? "Apply approved patch"
            : "Preview patch and request approval"
          : "Wait for a patch or model-generated change",
        status: input.patch ? "todo" : "skipped",
      },
      {
        id: "verify",
        title: "Run available verification commands",
        status: input.verify || input.applyPatch ? "todo" : "skipped",
      },
    ],
    risks: [
      "Model-generated patches are not automatic yet; this loop only applies an explicit patch after approval.",
    ],
    verification: ["Run npm verification scripts through the whitelist runner."],
    updatedAt: nowIso(),
  };
}

export async function runDevelopmentLoop(
  input: DevelopmentLoopInput,
): Promise<DevelopmentLoopResult> {
  const now = nowIso();
  const workspace = await getCurrentWorkspace();
  const thread: Thread = {
    id: newId("thread"),
    workspaceId: workspace.id,
    title: input.userRequest.slice(0, 80) || "Development task",
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
  const plan = createDevelopmentPlan(input);
  const events: AgentEvent[] = [
    { type: "thread.created", threadId: thread.id, thread },
    { type: "task.created", taskId: task.id, task },
    { type: "trace.linked", taskId: task.id, traceId: trace.id },
    { type: "turn.created", turnId: turn.id, turn },
    { type: "plan.updated", taskId: task.id, plan },
  ];

  const indexCall = toolCall("project.index", task.id, {
    rootPath: workspace.rootPath,
  });
  events.push({ type: "tool.started", taskId: task.id, toolCall: indexCall });
  const projectIndex = await buildProjectIndex(workspace.rootPath);
  events.push({
    type: "tool.completed",
    taskId: task.id,
    toolCall: completeToolCall(indexCall),
    result: {
      fileCount: projectIndex.files.length,
      routeCount: projectIndex.routes.length,
      apiRouteCount: projectIndex.apiRoutes.length,
      componentCount: projectIndex.components.length,
    },
  });

  const openableUrl = extractFirstOpenableUrl(input.userRequest);
  if (openableUrl) {
    const browserCall = toolCall("browser.open", task.id, {
      url: openableUrl,
    });
    events.push({
      type: "tool.started",
      taskId: task.id,
      toolCall: browserCall,
    });
    const browserTarget = await openBrowserUrl({
      url: openableUrl,
      requestedBy: "agent",
    });
    events.push({
      type: "tool.completed",
      taskId: task.id,
      toolCall: completeToolCall(browserCall),
      result: browserTarget,
    });
  }

  const locateCall = toolCall("file.locate", task.id, {
    query: input.userRequest,
  });
  events.push({ type: "tool.started", taskId: task.id, toolCall: locateCall });
  const located = locateFilesForRequest(projectIndex, input.userRequest, 12);
  events.push({
    type: "tool.completed",
    taskId: task.id,
    toolCall: completeToolCall(locateCall),
    result: {
      candidates: located.candidates.map((candidate) => ({
        filePath: candidate.file.filePath,
        kind: candidate.file.kind,
        route: candidate.file.route,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
    },
  });

  let patchSummary = "No patch was provided.";
  if (input.patch) {
    const patchCall = toolCall(
      input.applyPatch ? "patch.apply" : "patch.preview",
      task.id,
      { applyPatch: Boolean(input.applyPatch) },
    );
    events.push({ type: "tool.started", taskId: task.id, toolCall: patchCall });
    const patchResult = await applyUnifiedPatch({
      rootPath: workspace.rootPath,
      patch: input.patch,
      mode: input.applyPatch ? "apply" : "preview",
      approvalId: input.approvalId,
    });
    events.push({
      type: "tool.completed",
      taskId: task.id,
      toolCall: completeToolCall(patchCall),
      result: {
        mode: patchResult.mode,
        applied: patchResult.applied,
        patchHash: patchResult.patchHash,
        requiredApprovalAction: patchResult.requiredApprovalAction,
        files: patchResult.files.map((file) => ({
          filePath: file.newPath,
          changed: file.changed,
        })),
      },
    });

    if (input.applyPatch) {
      for (const file of patchResult.files) {
        if (file.changed) {
          events.push({
            type: "file.changed",
            taskId: task.id,
            filePath: file.newPath,
            diff: input.patch,
          });
        }
      }
      patchSummary = `Applied patch to ${patchResult.files.length} file(s).`;
    } else {
      const approval = createPatchApproval({
        taskId: task.id,
        patch: input.patch,
        result: patchResult,
      });
      events.push({
        type: "approval.required",
        taskId: task.id,
        approval,
      });
      patchSummary = `Previewed patch for ${patchResult.files.length} file(s); approval required.`;
    }
  }

  let verificationSummary = "Verification was not requested.";
  if (input.verify || input.applyPatch) {
    const verification = await runVerificationPlan(
      workspace.rootPath,
      input.verificationCommands,
    );
    for (const result of verification.results) {
      events.push({
        type: "verification.completed",
        taskId: task.id,
        result,
      });
    }
    verificationSummary = verification.success
      ? `Verification passed with ${verification.results.length} command(s).`
      : "Verification failed.";
  }

  const summary = [
    `Located ${located.candidates.length} candidate file(s).`,
    patchSummary,
    verificationSummary,
  ].join(" ");
  const completedTask: Task = {
    ...task,
    status: "completed",
    plan,
    updatedAt: nowIso(),
    completedAt: nowIso(),
  };
  events.push({
    type: "task.completed",
    taskId: task.id,
    task: completedTask,
    summary,
  });

  for (const event of events) {
    appendTraceEvent(trace.id, event);
  }

  return {
    traceId: trace.id,
    thread,
    task: completedTask,
    turn,
    events,
    summary,
  };
}

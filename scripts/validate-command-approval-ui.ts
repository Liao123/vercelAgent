/**
 * 命令审批 UI：按钮可见性 + 执行反馈 turn 路由。
 */
import assert from "node:assert/strict";
import { appendApprovalExecutionEvents, appendCommandApprovalRejectedEvents } from "../src/lib/approval-chat-events";
import {
  collectPendingCommandApprovals,
  extractShellVerificationResult,
  isAwaitingCommandExecution,
} from "../src/lib/command-approval-state";
import { groupEventsIntoTurns } from "../src/lib/agent-turn-feed";
import type { ApprovalRequest } from "../src/agent/types";

const shellApproval: ApprovalRequest & { status: "approved" } = {
  id: "ap1",
  taskId: "t1",
  title: "npm run dev",
  reason: "Execute command in workspace: npm run dev",
  risk: "medium",
  action: "shell.run:abc",
  createdAt: new Date().toISOString(),
  status: "approved",
  details: {
    kind: "shell_command",
    operationHash: "h",
    operation: { type: "raw", command: "npm run dev" },
    preview: {
      command: "npm run dev",
      risk: "medium",
      notes: [],
      available: true,
      operationType: "raw",
    },
  },
};

assert.equal(
  isAwaitingCommandExecution(shellApproval),
  true,
  "approved without execution still actionable",
);
assert.equal(
  isAwaitingCommandExecution({ ...shellApproval, status: "rejected" }),
  false,
);
assert.equal(
  isAwaitingCommandExecution({
    ...shellApproval,
    execution: { status: "succeeded", summary: "ok" },
  }),
  false,
);
assert.equal(
  isAwaitingCommandExecution(shellApproval, new Set(["ap1"])),
  false,
  "already executed in chat",
);

const extracted = extractShellVerificationResult(
  {
    result: {
      applied: true,
      result: {
        command: "npm run dev",
        success: true,
        output: "ready",
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  },
  shellApproval,
);
assert.ok(extracted?.success && extracted.output === "ready", "unwrap nested result");

const taskA = "task-a";
const taskB = "task-b";
let events = [
  {
    type: "task.created" as const,
    taskId: taskA,
    task: {
      id: taskA,
      userRequest: "跑 dev",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "running" as const,
    },
  },
  {
    type: "approval.required" as const,
    taskId: taskA,
    approval: shellApproval,
  },
  {
    type: "task.created" as const,
    taskId: taskB,
    task: {
      id: taskB,
      userRequest: "【继续原定任务】",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      status: "running" as const,
    },
  },
];

events = appendApprovalExecutionEvents(events, {
  taskId: taskA,
  approval: shellApproval,
  result: {
    command: "npm run dev",
    success: true,
    output: "Local: http://localhost:5173",
    completedAt: "2026-01-01T00:00:30.000Z",
  },
});

const turns = groupEventsIntoTurns(events);
assert.equal(turns.length, 2);
const turnA = turns.find((turn) => turn.taskId === taskA)!;
const turnB = turns.find((turn) => turn.taskId === taskB)!;
assert.ok(
  turnA.highlights.some((event) => event.type === "approval.executed"),
  "execution highlight on original turn",
);
assert.ok(
  turnA.highlights.some((event) => event.type === "assistant.notice"),
  "notice bubble on original turn",
);
assert.ok(
  !turnB.highlights.some((event) => event.type === "approval.executed"),
  "execution not on continuation turn",
);

const staleEvents = [
  {
    type: "approval.required" as const,
    taskId: "task-stale",
    approval: { ...shellApproval, id: "ap_old", taskId: "task-stale" },
  },
  {
    type: "approval.required" as const,
    taskId: "task-stale",
    approval: { ...shellApproval, id: "ap_new", taskId: "task-stale" },
  },
];
const stalePending = collectPendingCommandApprovals(staleEvents, []);
assert.equal(stalePending.length, 1, "only latest required per task");
assert.equal(stalePending[0]?.id, "ap_new", "latest approval id kept");

const doneEvents = appendApprovalExecutionEvents(staleEvents, {
  taskId: "task-stale",
  approval: { ...shellApproval, id: "ap_new", taskId: "task-stale" },
  result: {
    command: "npm run dev",
    success: true,
    output: "ok",
    completedAt: "2026-01-01T00:00:30.000Z",
  },
});
assert.equal(
  collectPendingCommandApprovals(doneEvents, []).length,
  0,
  "bar clears after execute",
);

const rejectedEvents = appendCommandApprovalRejectedEvents(staleEvents, {
  taskId: "task-stale",
  approval: { ...shellApproval, id: "ap_new", taskId: "task-stale" },
});
assert.equal(
  collectPendingCommandApprovals(rejectedEvents, [
    {
      ...shellApproval,
      id: "ap_new",
      taskId: "task-stale",
      status: "rejected",
    },
  ]).length,
  0,
  "bar clears after reject even when only event had pending",
);

console.log("validate-command-approval-ui: passed");

/**
 * 授权执行后续跑 Loop 静态验收。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildApprovalLoopContinuationRequest,
  findUserRequestForTask,
  shouldResumeLoopAfterApprovalExecute,
} from "../src/lib/approval-loop-continuation.ts";

async function main(): Promise<void> {
  const panel = await fs.readFile("src/components/agent-panel.tsx", "utf8");
  assert.ok(panel.includes("maybeResumeLoopAfterApproval"), "panel resumes loop");
  assert.ok(panel.includes("pendingApprovalContinuationRef"), "panel queues resume while running");
  assert.ok(panel.includes("flushPendingApprovalContinuation"), "panel flushes queued resume");
  assert.ok(panel.includes("appendSession"), "panel preserves session events");
  assert.ok(panel.includes("setContinueThreadMemory(true)"), "thread memory on create");

  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  assert.ok(
    loop.includes("generateLoopModelWithProgress"),
    "loop streams model progress",
  );
  assert.ok(
    loop.includes("if (!input.threadId)"),
    "thread.created only for new threads",
  );

  assert.ok(
    shouldResumeLoopAfterApprovalExecute({
      id: "a1",
      title: "npm test",
      details: { kind: "shell_command" },
    }),
    "shell resumes",
  );
  assert.ok(
    !shouldResumeLoopAfterApprovalExecute({
      id: "a2",
      title: "write file",
      details: { kind: "file_mutation" },
    }),
    "file mutation no auto resume",
  );

  const prior = findUserRequestForTask("task_1", [
    { type: "task.created", taskId: "task_1", task: { userRequest: "跑一下测试" } },
  ]);
  assert.equal(prior, "跑一下测试");

  const continuation = buildApprovalLoopContinuationRequest(
    {
      id: "ap1",
      title: "npm test",
      details: { kind: "shell_command" },
      execution: {
        status: "succeeded",
        summary: "Ran npm test.",
        result: {
          kind: "shell_command",
          command: "npm test",
          success: true,
          output: "All tests passed",
        },
      },
    },
    {
      result: {
        kind: "shell_command",
        command: "npm test",
        success: true,
        output: "All tests passed",
      },
    },
    "跑一下测试",
  );
  assert.ok(continuation.includes("继续原定任务"));
  assert.ok(continuation.includes("All tests passed"));
  assert.ok(continuation.includes("跑一下测试"));

  const failedContinuation = buildApprovalLoopContinuationRequest(
    {
      id: "ap2",
      title: "npm test",
      details: { kind: "shell_command" },
      execution: {
        status: "failed",
        summary: "Execution failed.",
        error: "Tests failed",
        result: {
          kind: "shell_command",
          command: "npm test",
          success: false,
          output: "1 failed",
        },
      },
    },
    {
      result: {
        kind: "shell_command",
        command: "npm test",
        success: false,
        output: "1 failed",
      },
      approval: {
        execution: {
          status: "failed",
          summary: "Execution failed.",
          error: "Tests failed",
        },
      },
    },
    "跑测试",
  );
  assert.ok(failedContinuation.includes("Tests failed"));
  assert.ok(failedContinuation.includes("1 failed"));
  assert.ok(failedContinuation.includes("不得直接 final 结束"));

  const nested = buildApprovalLoopContinuationRequest(
    {
      id: "ap3",
      title: "npm run dev",
      details: { kind: "shell_command" },
      execution: {
        status: "failed",
        error: "Port 5173 is in use",
        result: {
          kind: "shell_command",
          command: "npm run dev",
          success: false,
          output: "Port 5173 is in use",
        },
      },
    },
    {
      result: {
        applied: true,
        result: {
          command: "npm run dev",
          success: false,
          output: "Port 5173 is in use",
        },
      },
    },
    "跑 dev",
  );
  assert.ok(nested.includes("Port 5173 is in use"));
  assert.ok(nested.includes("--port 3001"));

  console.log("validate-approval-continuation: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

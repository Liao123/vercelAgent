/**
 * A151 Shell in-loop resume smoke（无需 LLM / dev server）。
 *
 * 运行：npm run validate:shell-loop-resume
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  clearLoopShellCheckpoint,
  getLoopShellCheckpoint,
  hasLoopShellCheckpoint,
  isShellLoopResumeEnabled,
  saveLoopShellCheckpoint,
  consumeLoopShellCheckpoint,
} from "../src/agent/core/loop-shell-checkpoint";
import { buildShellExecutionResumeMessage } from "../src/agent/core/shell-loop-resume";

async function main(): Promise<void> {
  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  const panel = await fs.readFile("src/components/agent-panel.tsx", "utf8");
  const route = await fs.readFile("src/app/api/agent/loop/route.ts", "utf8");
  const runner = await fs.readFile("src/agent/core/agent-loop-tool-runner.ts", "utf8");

  assert.ok(loop.includes("saveLoopShellCheckpoint"), "loop saves shell checkpoint");
  assert.ok(loop.includes("task.awaiting_approval"), "loop emits awaiting_approval");
  assert.ok(loop.includes("buildShellExecutionResumeMessage"), "loop injects shell resume");
  assert.ok(loop.includes("consumeLoopShellCheckpoint"), "loop consumes checkpoint");
  assert.ok(runner.includes("pendingShellApproval"), "tool runner tags shell approval");
  assert.ok(panel.includes("shellResume"), "panel passes shellResume");
  assert.ok(route.includes("shellResume"), "loop API accepts shellResume");
  assert.ok(isShellLoopResumeEnabled(), "shell resume enabled by default");

  const threadId = "thread_validate_shell_resume";
  clearLoopShellCheckpoint(threadId);

  saveLoopShellCheckpoint({
    threadId,
    taskId: "task_1",
    savedAt: new Date().toISOString(),
    iteration: 2,
    maxIterations: 12,
    effectiveUserRequest: "跑一下 validate:agent",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "跑一下 validate:agent" },
    ],
    runState: {
      userRequest: "跑一下 validate:agent",
      likelyEditRequest: false,
      approvalPrepared: true,
      toolsCalled: ["shell.run.prepare"],
      filesRead: [],
      reflectionRounds: 0,
    },
    pendingShell: {
      toolCallId: "call_1",
      toolName: "shell.run.prepare",
      approvalId: "ap_1",
      command: "npm run validate:agent",
    },
  });

  assert.ok(hasLoopShellCheckpoint(threadId, "ap_1"));
  const loaded = getLoopShellCheckpoint(threadId);
  assert.equal(loaded?.pendingShell.command, "npm run validate:agent");

  const consumed = consumeLoopShellCheckpoint(threadId, "ap_1");
  assert.ok(consumed);
  assert.equal(hasLoopShellCheckpoint(threadId), false);

  const resumeMsg = buildShellExecutionResumeMessage({
    pendingShell: consumed!.pendingShell,
    result: {
      command: "npm run validate:agent",
      success: true,
      output: "validate:agent: passed",
      completedAt: new Date().toISOString(),
    },
    priorUserRequest: "跑一下 validate:agent",
  });
  assert.ok(resumeMsg.includes("[SHELL_EXECUTED"));
  assert.ok(resumeMsg.includes("validate:agent: passed"));

  console.log("validate-shell-loop-resume: passed");
}

main().catch((error) => {
  console.error("validate-shell-loop-resume failed:", error);
  process.exit(1);
});

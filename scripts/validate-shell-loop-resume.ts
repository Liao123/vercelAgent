/**
 * A151 / A166 Shell in-loop resume + tool_result 闭环 smoke（无需 LLM / dev server）。
 *
 * 运行：npm run validate:shell-loop-resume
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { AgentMessage } from "../src/agent/types";
import {
  clearLoopShellCheckpoint,
  getLoopShellCheckpoint,
  hasLoopShellCheckpoint,
  isShellLoopResumeEnabled,
  saveLoopShellCheckpoint,
  consumeLoopShellCheckpoint,
} from "../src/agent/core/loop-shell-checkpoint";
import {
  applyShellExecutionToMessages,
  buildShellExecutionResumeMessage,
  buildShellExecutedToolResultContent,
} from "../src/agent/core/shell-loop-resume";

async function main(): Promise<void> {
  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  const panel = await fs.readFile("src/components/agent-panel.tsx", "utf8");
  const route = await fs.readFile("src/app/api/agent/loop/route.ts", "utf8");
  const runner = await fs.readFile("src/agent/core/agent-loop-tool-runner.ts", "utf8");

  assert.ok(loop.includes("saveLoopShellCheckpoint"), "loop saves shell checkpoint");
  assert.ok(loop.includes("task.awaiting_approval"), "loop emits awaiting_approval");
  assert.ok(loop.includes("applyShellExecutionToMessages"), "loop applies tool_result");
  assert.ok(loop.includes("consumeLoopShellCheckpoint"), "loop consumes checkpoint");
  assert.ok(runner.includes("pendingShellApproval"), "tool runner tags shell approval");
  assert.ok(panel.includes("shellResume"), "panel passes shellResume");
  assert.ok(panel.includes("shellAwaitingRef"), "panel tracks awaiting_approval");
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

  const nativeMessages: AgentMessage[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_native",
          type: "function",
          function: {
            name: "shell.run.prepare",
            arguments: '{"command":"npm run validate:agent"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_native",
      content:
        'Observation from shell.run.prepare:\n{"prepared":true,"approvalId":"ap_1"}',
    },
  ];
  const applied = applyShellExecutionToMessages(nativeMessages, {
    pendingShell: {
      toolCallId: "call_native",
      toolName: "shell.run.prepare",
      approvalId: "ap_1",
      command: "npm run validate:agent",
    },
    result: {
      command: "npm run validate:agent",
      success: true,
      output: "validate:agent: passed",
      completedAt: new Date().toISOString(),
    },
    priorUserRequest: "跑一下 validate:agent",
  });
  assert.ok(applied, "native tool_result replaced");
  assert.ok(
    String(nativeMessages[1]?.content).includes("executed_after_approval"),
    "tool content marks execution",
  );
  assert.ok(
    String(nativeMessages[1]?.content).includes("validate:agent: passed"),
    "tool content includes stdout",
  );

  const toolContent = buildShellExecutedToolResultContent({
    pendingShell: consumed!.pendingShell,
    result: {
      command: "npm run validate:agent",
      success: true,
      output: "validate:agent: passed",
      completedAt: new Date().toISOString(),
    },
  });
  assert.ok(toolContent.startsWith("Observation from shell.run.prepare:"));

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

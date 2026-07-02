/**
 * Codex-like middle-column timeline behavior:
 * bounded live history, recoverable errors collapsed, and completed plan chip state.
 *
 * Run: npm run validate:codex-middle-column
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function main(): Promise<void> {
  const timeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-reasoning-timeline.tsx`,
    "utf8",
  );
  const strip = await fs.readFile(
    `${process.cwd()}/src/components/agent-run-status-strip.tsx`,
    "utf8",
  );
  const reasoningSteps = await fs.readFile(
    `${process.cwd()}/src/lib/agent-reasoning-steps.ts`,
    "utf8",
  );
  const loop = await fs.readFile(
    `${process.cwd()}/src/agent/core/agent-loop.ts`,
    "utf8",
  );

  assert.ok(
    timeline.includes("LIVE_VISIBLE_STEP_LIMIT = 3"),
    "live timeline keeps a bounded recent window",
  );
  assert.ok(
    timeline.includes("showAllSteps"),
    "older live steps can still be expanded",
  );
  assert.ok(
    timeline.includes("agentToolIssueLabel"),
    "recoverable tool errors use the shared continued-work label",
  );
  assert.ok(
    timeline.includes("formatAgentToolIssueDetail(error)"),
    "raw tool errors remain available in details",
  );
  assert.ok(
    timeline.includes("function ActionGroup"),
    "multiple tool actions are grouped instead of rendered as a log wall",
  );
  assert.ok(
    !timeline.includes("\\u5de5\\u5177\\u8fd0\\u884c\\u4e2d") &&
      !timeline.includes("工具运行中"),
    "synthetic tool-only steps do not show a fixed running-tools heading",
  );
  assert.ok(
    reasoningSteps.includes("isBackgroundWorkspaceInspect") &&
      reasoningSteps.includes("\\u542f\\u52a8\\u65f6\\u9884\\u8f7d"),
    "startup workspace inspect is filtered from the visible reasoning timeline",
  );
  assert.ok(
    !loop.includes('emit({\n        type: "tool.started",\n        taskId: task.id,\n        toolCall: inspectToolCall') &&
      loop.includes('recordToolCall(runState, "workspace.inspect", inspectResult);'),
    "startup workspace facts stay in agent state without being emitted as a visible tool event",
  );
  assert.ok(
    !timeline.includes("function stepLabel") &&
      !timeline.includes("第 ${Math.max") &&
      timeline.includes('playbook?.id === "default" ? undefined : playbook'),
    "middle timeline hides internal loop rounds and generic default playbook",
  );
  assert.ok(
    timeline.includes("已运行 ${actions.length} 条工具"),
    "grouped action summary uses a compact completed-tools label",
  );
  assert.ok(
    timeline.includes("查看细节"),
    "tool rationale and raw details are hidden behind disclosure",
  );
  assert.ok(
    !timeline.includes("toolCall.rationale && ("),
    "tool rationale should not render as a primary timeline line",
  );
  assert.ok(
    timeline.includes("已记录上轮问题，正在换策略继续。"),
    "stale blockers are summarized while the task is still running",
  );
  assert.ok(
    strip.includes("progress.completed >= progress.total"),
    "plan chip marks all-done plans as complete",
  );
  assert.ok(strip.includes("✓"), "completed plan chip shows a check mark");

  console.log("validate-codex-middle-column: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

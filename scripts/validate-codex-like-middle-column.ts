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

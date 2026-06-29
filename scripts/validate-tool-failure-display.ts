/**
 * Codex-like recoverable tool failure display.
 *
 * Run: npm run validate:tool-failure-display
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  agentToolIssueLabel,
  formatAgentToolAction,
  formatAgentToolIssueDetail,
} from "../src/lib/agent-tool-display";
import { formatReflectionBlockersLine } from "../src/lib/reflection-blockers-ui";

async function main(): Promise<void> {
  assert.equal(
    agentToolIssueLabel({ taskStillRunning: true }),
    "遇到问题，正在换策略",
  );
  assert.equal(
    agentToolIssueLabel({ recovered: true, taskStillRunning: true }),
    "遇到问题，已继续",
  );
  assert.deepEqual(
    formatAgentToolAction({
      toolName: "file.read",
      args: { path: "missing.ts" },
      error: "ENOENT: no such file",
    }),
    {
      action: "读取文件",
      target: "missing.ts",
      label: "读取文件",
    },
  );
  assert.ok(formatAgentToolIssueDetail("<html><title>502</title></html>").includes("HTML 错误页"));
  assert.equal(
    formatReflectionBlockersLine(["ENOENT: missing"], {
      taskStillRunning: true,
    }),
    "待处理：遇到问题，正在换策略。",
  );

  const timeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-reasoning-timeline.tsx`,
    "utf8",
  );
  const worked = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-worked-line.tsx`,
    "utf8",
  );
  const events = await fs.readFile(
    `${process.cwd()}/src/components/agent-event-timeline.tsx`,
    "utf8",
  );

  assert.ok(timeline.includes("agentToolIssueLabel"));
  assert.ok(worked.includes('tone={event.toolCall.error ? "warn" : "neutral"}'));
  assert.ok(worked.includes("defaultOpen={Boolean(gitSnapshot?.dirty)}"));
  assert.ok(events.includes('tone={event.toolCall.error ? "warn" : "success"}'));
  assert.ok(!events.includes("summary={event.toolCall.error ??"));

  console.log("validate-tool-failure-display: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

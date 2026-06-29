/**
 * Agent run status strip: current plan progress + changed files hover preview.
 *
 * Run: npm run validate:run-status-strip
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { AgentEvent, AgentPlan } from "../src/agent/types";
import { resolvePlanProgress } from "../src/components/agent-run-status-strip";
import {
  collectTurnFileChanges,
  countUnifiedDiffStats,
} from "../src/lib/approval-file-changes";

async function main(): Promise<void> {
  const plan: AgentPlan = {
    goal: "add live run status",
    steps: [
      { step: "read context", status: "completed" },
      { step: "build strip", status: "in_progress" },
      { step: "verify behavior", status: "pending" },
    ],
    risks: [],
    verification: ["npm run validate:run-status-strip"],
    updatedAt: new Date(0).toISOString(),
  };

  const progress = resolvePlanProgress(plan);
  assert.equal(progress.current, 2);
  assert.equal(progress.total, 3);
  assert.equal(progress.completed, 1);
  assert.equal(progress.activeStep?.step, "build strip");

  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "-old",
    "+new",
    "+extra",
  ].join("\n");
  assert.deepEqual(countUnifiedDiffStats(diff), {
    additions: 2,
    deletions: 1,
  });

  const changes = collectTurnFileChanges([
    {
      type: "file.changed",
      taskId: "task",
      filePath: "src\\a.ts",
      diff,
    } satisfies AgentEvent,
  ]);
  assert.equal(changes?.files.length, 1);
  assert.equal(changes?.files[0]?.path, "src/a.ts");
  assert.equal(changes?.files[0]?.directDiff, diff);
  assert.equal(changes?.totalAdditions, 2);
  assert.equal(changes?.totalDeletions, 1);

  const component = await fs.readFile(
    `${process.cwd()}/src/components/agent-run-status-strip.tsx`,
    "utf8",
  );
  assert.ok(component.includes("group-hover/plan:visible"));
  assert.ok(component.includes("group-hover/file:block"));
  assert.ok(component.includes("overflow-auto"));
  assert.ok(component.includes("<DiffView"));
  assert.ok(component.includes("collectTurnFileChanges(events)"));
  assert.ok(component.includes("step.step || step.title"));

  const panel = await fs.readFile(
    `${process.cwd()}/src/components/agent-panel.tsx`,
    "utf8",
  );
  assert.ok(panel.includes("AgentRunStatusStrip"));
  assert.ok(panel.includes("<AgentRunStatusStrip events={events} running={running} />"));

  console.log("validate-run-status-strip: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

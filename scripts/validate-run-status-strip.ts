/**
 * Agent run status strip: current plan progress + live changed-file status.
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
  fileChangesFromUnifiedDiff,
  inferWritingFileChangesFromToolEvent,
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
      oldContent: "old\n",
      newContent: "new\nextra\n",
    } satisfies AgentEvent,
  ]);
  assert.equal(changes?.files.length, 1);
  assert.equal(changes?.files[0]?.path, "src/a.ts");
  assert.equal(changes?.files[0]?.directDiff, diff);
  assert.equal(changes?.files[0]?.singleFileDiff?.before, "old\n");
  assert.equal(changes?.totalAdditions, 2);
  assert.equal(changes?.totalDeletions, 1);

  const writingEvent = {
    type: "tool.started",
    taskId: "task",
    toolCall: {
      id: "call_write",
      taskId: "task",
      toolName: "file.mutation",
      args: {
        type: "create",
        path: "index.html",
        content: "<main>\nhello\n</main>\n",
      },
      startedAt: new Date(0).toISOString(),
    },
  } satisfies AgentEvent;
  const inferred = inferWritingFileChangesFromToolEvent(writingEvent);
  assert.equal(inferred[0]?.path, "index.html");
  assert.equal(inferred[0]?.additions, 3);
  assert.equal(inferred[0]?.isWriting, true);

  const writingChanges = collectTurnFileChanges([writingEvent]);
  assert.equal(writingChanges?.status, "writing");
  assert.equal(writingChanges?.files[0]?.path, "index.html");
  assert.equal(writingChanges?.totalAdditions, 3);

  const turnDiffChanges = collectTurnFileChanges([
    {
      type: "turn.diff.updated",
      taskId: "task",
      filePath: "src/a.ts",
      diff,
      at: new Date(0).toISOString(),
    } satisfies AgentEvent,
  ]);
  assert.equal(turnDiffChanges?.status, "writing");
  assert.equal(turnDiffChanges?.files[0]?.path, "src/a.ts");
  assert.equal(turnDiffChanges?.totalAdditions, 2);
  assert.equal(fileChangesFromUnifiedDiff(diff)[0]?.deletions, 1);

  const component = await fs.readFile(
    `${process.cwd()}/src/components/agent-run-status-strip.tsx`,
    "utf8",
  );
  assert.ok(component.includes("group-hover/plan:visible"));
  assert.ok(component.includes("max-w-lg"));
  assert.ok(!component.includes("<DiffView"));
  assert.ok(!component.includes("FileDiffPreview"));
  assert.ok(component.includes("collectTurnFileChanges(events)"));
  assert.ok(component.includes("flash"));
  assert.ok(component.includes('changes.status === "writing"'));
  assert.ok(component.includes("step.step || step.title"));
  assert.ok(component.includes("onReviewFileChange?.(file.path)"));

  const turnBlock = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-block.tsx`,
    "utf8",
  );
  assert.ok(turnBlock.includes("const shouldShowFileChangeCard"));
  assert.ok(turnBlock.includes("!isActive"));
  assert.ok(turnBlock.includes('turn.fileChanges?.status === "pending"'));

  const panel = await fs.readFile(
    `${process.cwd()}/src/components/agent-panel.tsx`,
    "utf8",
  );
  assert.ok(panel.includes("AgentRunStatusStrip"));
  assert.ok(panel.includes("onReviewFileChange={openReviewForPath}"));
  assert.ok(panel.includes("const submittedRequest = request"));
  assert.ok(panel.includes("setRequest(\"\")"));
  assert.ok(panel.includes("submittedAttachedFiles"));
  assert.ok(panel.includes("请根据附加文件完成任务。"));

  const types = await fs.readFile(`${process.cwd()}/src/agent/types.ts`, "utf8");
  const harness = await fs.readFile(
    `${process.cwd()}/src/agent/protocol/harness.ts`,
    "utf8",
  );
  const directApply = await fs.readFile(
    `${process.cwd()}/src/agent/core/loop-direct-apply.ts`,
    "utf8",
  );
  assert.ok(types.includes('type: "turn.diff.updated"'));
  assert.ok(harness.includes('"turn.diff.updated"'));
  assert.ok(directApply.includes('type: "turn.diff.updated"'));

  console.log("validate-run-status-strip: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

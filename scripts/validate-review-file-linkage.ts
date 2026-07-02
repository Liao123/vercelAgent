/**
 * A107：审查区与文件树/中栏变更卡联动。
 */
import assert from "node:assert/strict";
import {
  collectReviewFileChanges,
  collectTurnFileChanges,
  reviewDisplayFromTurnFileChanges,
} from "../src/lib/approval-file-changes";
import type { AgentEvent } from "../src/agent/types";

const fileDetails = {
  kind: "file_mutation" as const,
  operationHash: "hash",
  operation: { type: "write" as const, path: "src/a.tsx", content: "x" },
  preview: {
    type: "write" as const,
    path: "src/a.tsx",
    existsBefore: true,
    existsAfter: true,
    oldContent: {
      text: "old",
      length: 3,
      lineCount: 1,
      truncated: false,
    },
    newContent: {
      text: "new",
      length: 3,
      lineCount: 1,
      truncated: false,
    },
  },
};

const executed = {
  id: "approval_exec",
  taskId: "task_current",
  status: "approved" as const,
  execution: { status: "succeeded" as const },
  details: fileDetails,
};

const pending = {
  id: "approval_pending",
  taskId: "task_other",
  status: "pending" as const,
  details: {
    ...fileDetails,
    preview: { ...fileDetails.preview, path: "src/b.tsx" },
    operation: { type: "write" as const, path: "src/b.tsx", content: "y" },
  },
};

const sameTask = collectReviewFileChanges([executed], "task_current", null);
assert.equal(sameTask.files.length, 1);
assert.equal(sameTask.files[0]?.path, "src/a.tsx");

const otherTask = collectReviewFileChanges([executed], "task_other", null);
assert.equal(otherTask.files.length, 0);

const focused = collectReviewFileChanges(
  [executed, pending],
  "task_other",
  "approval_exec",
);
assert.equal(focused.approvalId, "approval_exec");
assert.equal(focused.files[0]?.path, "src/a.tsx");

const directChanges = collectTurnFileChanges([
  {
    type: "file.changed",
    taskId: "task_current",
    filePath: "src/direct.tsx",
    diff: [
      "--- a/src/direct.tsx",
      "+++ b/src/direct.tsx",
      "@@ -1,1 +1,2 @@",
      "-old",
      "+new",
      "+extra",
    ].join("\n"),
    oldContent: "old\n",
    newContent: "new\nextra\n",
  } satisfies AgentEvent,
]);
const directReview = reviewDisplayFromTurnFileChanges(directChanges);
assert.equal(directReview?.source, "direct");
assert.equal(directReview?.files[0]?.path, "src/direct.tsx");
assert.equal(directReview?.totalAdditions, 2);
assert.equal(directReview?.totalDeletions, 1);

console.log("validate-review-file-linkage: passed");

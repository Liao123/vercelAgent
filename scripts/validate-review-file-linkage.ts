/**
 * A107：审查区与文件树/中栏变更卡联动。
 */
import assert from "node:assert/strict";
import { collectReviewFileChanges } from "../src/lib/approval-file-changes";

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

console.log("validate-review-file-linkage: passed");

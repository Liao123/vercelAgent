/**
 * 审批列表 API 瘦身：列表默认去掉 content 快照，避免 GET /api/agent/approvals 超时。
 */
import assert from "node:assert/strict";
import {
  approvalDetailsPayloadBytes,
  getApprovalById,
  listApprovals,
  needsApprovalDetailsHydration,
  summarizeApprovalDetails,
  summarizeApprovalForList,
} from "../src/agent/approval";

function loadSampleApprovalFromDisk():
  | ReturnType<typeof getApprovalById>
  | undefined {
  const recent = listApprovals({ full: true, limit: 50 });
  const match = recent.find((approval) => approval.details);
  if (!match) return undefined;
  return getApprovalById(match.id);
}

const synthetic = {
  id: "approval_validate_list",
  taskId: "task_validate_approval_list",
  title: "validate approval list summary",
  reason: "unit test",
  risk: "low" as const,
  action: "write",
  createdAt: new Date().toISOString(),
  status: "pending" as const,
  details: {
    kind: "file_mutation" as const,
    operationHash: "hash",
    operation: { type: "write" as const, path: "src/example.ts", content: "x".repeat(4000) },
    preview: {
      type: "write" as const,
      path: "src/example.ts",
      existsBefore: false,
      existsAfter: true,
      oldContent: {
        text: "",
        length: 0,
        lineCount: 0,
        truncated: false,
      },
      newContent: {
        text: "x".repeat(4000),
        length: 4000,
        lineCount: 1,
        truncated: false,
      },
    },
  },
};

const summarized = summarizeApprovalForList(synthetic);
assert.ok(synthetic.details);
assert.ok(summarized.details);
assert.equal(summarized.details.kind, "file_mutation");
if (summarized.details.kind === "file_mutation") {
  assert.equal(summarized.details.preview.oldContent, undefined);
  assert.equal(summarized.details.preview.newContent, undefined);
  assert.equal(summarized.details.preview.path, "src/example.ts");
  if (
    synthetic.details.kind === "file_mutation" &&
    (synthetic.details.operation.type === "write" ||
      synthetic.details.operation.type === "create")
  ) {
    assert.equal(summarized.details.operation.content, "");
  }
}
assert.ok(
  approvalDetailsPayloadBytes(summarized.details) <
    approvalDetailsPayloadBytes(synthetic.details!),
);
assert.equal(needsApprovalDetailsHydration(summarized.details), true);
assert.equal(needsApprovalDetailsHydration(synthetic.details), false);

const patchDetails = summarizeApprovalDetails({
  kind: "patch_apply",
  operationHash: "p",
  patch: "--- a\n+++ b\n".repeat(200),
  preview: {
    fileCount: 1,
    changedCount: 1,
    files: [
      {
        filePath: "a.ts",
        changed: true,
        oldContent: { text: "old", length: 3, lineCount: 1, truncated: false },
        newContent: { text: "new", length: 3, lineCount: 1, truncated: false },
      },
    ],
    patchPreview: {
      text: "preview",
      length: 7,
      lineCount: 1,
      truncated: false,
    },
  },
});
assert.equal(patchDetails.kind, "patch_apply");
if (patchDetails.kind === "patch_apply") {
  assert.equal(patchDetails.patch, "");
  assert.equal(patchDetails.preview.files[0]?.oldContent, undefined);
}

const list = listApprovals({ limit: 5 });
assert.ok(Array.isArray(list));
for (const item of list) {
  if (!item.details) continue;
  assert.ok(
    approvalDetailsPayloadBytes(item.details) < 32_000,
    `list item ${item.id} still too large`,
  );
}

const full = loadSampleApprovalFromDisk();
if (full?.details) {
  if (full.details.kind === "file_mutation") {
    assert.ok(
      full.details.preview.newContent?.text ||
        full.details.preview.oldContent?.text,
    );
  }
  const sampleSummary = summarizeApprovalForList(full);
  assert.ok(sampleSummary.details);
  const before = approvalDetailsPayloadBytes(full.details);
  const after = approvalDetailsPayloadBytes(sampleSummary.details);
  assert.ok(after <= before);
  if (before > 8_000) {
    assert.ok(
      after < before / 2,
      "expected meaningful shrink for large approval",
    );
  }
} else {
  console.log(
    "validate-approval-list-api: skipped on-disk sample (no approval with details)",
  );
}

console.log("validate-approval-list-api: passed");

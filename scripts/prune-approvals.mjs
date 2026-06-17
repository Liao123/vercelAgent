/**
 * 压缩 .agent-state/approvals.json 历史快照（保留最近 N 条完整 details）。
 *
 * 用法：node scripts/prune-approvals.mjs [keepCount]
 */
import { compactApprovalHistory } from "../src/agent/approval/approval-store.ts";

const keepCount = Number.parseInt(process.argv[2] ?? "25", 10);

const result = compactApprovalHistory({
  keepFullDetailCount: Number.isFinite(keepCount) ? keepCount : 25,
});

console.log("prune-approvals:", {
  total: result.total,
  compacted: result.compacted,
  bytesBefore: result.bytesBefore,
  bytesAfter: result.bytesAfter,
  savedKb: Math.round((result.bytesBefore - result.bytesAfter) / 1024),
});

if (result.compacted === 0) {
  console.log("prune-approvals: nothing to compact");
} else {
  console.log("prune-approvals: PASSED");
}

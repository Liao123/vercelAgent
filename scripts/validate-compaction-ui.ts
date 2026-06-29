/**
 * A127：活动流 / 推理时间线展示压缩层 layersApplied。
 *
 * 运行：npm run validate:compaction-ui
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  formatCompactionCheckpoint,
  formatCompactionLayers,
  formatCompactionMeta,
} from "../src/lib/compaction-labels";

async function main(): Promise<void> {
  const layers = formatCompactionLayers(["snip:4", "soft:16", "auto"]);
  assert.equal(layers, "snip:4, soft:16, auto");

  const meta = formatCompactionMeta({
    method: "deterministic",
    round: 2,
    estimatedTokensBefore: 21258,
    estimatedTokensAfter: 8312,
    contextWindow: { windowNumber: 2 },
    layersApplied: ["soft:16", "auto"],
  });
  assert.ok(meta.includes("window 2"));
  assert.ok(meta.includes("layers soft:16, auto"));
  assert.ok(meta.includes("8312"));

  const checkpoint = formatCompactionCheckpoint({
    method: "semantic",
    round: 3,
    estimatedTokensBefore: 32000,
    estimatedTokensAfter: 9800,
    contextWindow: { windowNumber: 4 },
    pinnedApprovalCount: 2,
    changedFileCount: 7,
    layersApplied: ["soft:16", "auto"],
    summaryPreview: "保留当前任务目标、审批和关键文件变更。",
  });
  assert.equal(checkpoint.title, "上下文已接续");
  assert.equal(checkpoint.label, "上下文已接续 · window 4");
  assert.ok(checkpoint.summary.includes("保留当前任务目标"));
  assert.ok(checkpoint.meta.includes("2 个审批 ID"));
  assert.ok(checkpoint.meta.includes("7 个文件"));
  assert.ok(checkpoint.detail?.includes("CONTEXT CHECKPOINT HANDOFF"));

  const timeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-event-timeline.tsx`,
    "utf8",
  );
  const worked = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-worked-line.tsx`,
    "utf8",
  );
  const panel = await fs.readFile(
    `${process.cwd()}/src/components/agent-panel.tsx`,
    "utf8",
  );
  const memoryPanel = await fs.readFile(
    `${process.cwd()}/src/components/agent-compacted-memory-panel.tsx`,
    "utf8",
  );
  const feed = await fs.readFile(
    `${process.cwd()}/src/lib/agent-feed.ts`,
    "utf8",
  );

  assert.ok(timeline.includes("formatCompactionCheckpoint"));
  assert.ok(worked.includes("formatCompactionCheckpoint"));
  assert.ok(panel.includes("formatCompactionCheckpoint(parsed).status"));
  assert.ok(memoryPanel.includes("formatCompactionCheckpoint"));
  assert.ok(feed.includes("layersApplied: event.layersApplied"));
  assert.ok(!worked.includes("label={`压缩上下文"));
  assert.ok(!timeline.includes('title="上下文已压缩"'));

  console.log("validate-compaction-ui: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

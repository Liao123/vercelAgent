/**
 * A127：活动流 / 推理时间线展示压缩层 layersApplied。
 *
 * 运行：npm run validate:compaction-ui
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
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
    layersApplied: ["soft:16", "auto"],
  });
  assert.ok(meta.includes("layers soft:16, auto"));
  assert.ok(meta.includes("8312"));

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

  assert.ok(timeline.includes("layersApplied: event.layersApplied"));
  assert.ok(worked.includes("layersApplied: event.layersApplied"));
  assert.ok(panel.includes("formatCompactionLayers"));

  console.log("validate-compaction-ui: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

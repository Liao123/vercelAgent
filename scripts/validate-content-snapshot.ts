/**
 * 校验大文件小改动的 contentSnapshotPair 仍能产出可见 diff。
 */
import assert from "node:assert/strict";
import { contentSnapshotPair } from "../src/agent/approval/content-snapshot";
import { snapshotDiffText } from "../src/lib/snapshot-diff-text";
import { computeLineDiff } from "../src/lib/line-diff";

function buildLargeFile(changeLine: number, marker: string): string {
  const lines: string[] = [];
  for (let i = 1; i <= 800; i += 1) {
    if (i === changeLine) {
      lines.push(marker);
    } else {
      lines.push(`// placeholder line ${i} padding text to simulate large component file`);
    }
  }
  return lines.join("\n");
}

function main() {
  const oldContent = buildLargeFile(612, 'export function AgentRightRail() {');
  const newContent = buildLargeFile(612, 'export function AgentRightRail中文() {');

  const pair = contentSnapshotPair(oldContent, newContent);
  assert.ok(pair.old.truncated, "old snapshot should be truncated");
  assert.ok(pair.new.truncated, "new snapshot should be truncated");
  assert.ok(pair.old.startLine && pair.old.startLine > 500, "old startLine near change");
  assert.ok(pair.new.startLine && pair.new.startLine > 500, "new startLine near change");

  const oldSlice = snapshotDiffText(pair.old);
  const newSlice = snapshotDiffText(pair.new);
  const diff = computeLineDiff(oldSlice.text, newSlice.text).filter(
    (row) => row.kind !== "equal",
  );
  assert.ok(diff.length > 0, "focused snapshot diff should not be empty");

  console.log(
    `validate-content-snapshot: diff rows=${diff.length}, startLine old=${pair.old.startLine} new=${pair.new.startLine}`,
  );
}

main();

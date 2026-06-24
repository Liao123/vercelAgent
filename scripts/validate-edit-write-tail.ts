/**
 * 改码收尾 / 写盘延长期边界（无 scaffold 硬注入）。
 *
 * 运行：npm run validate:edit-write-tail
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import {
  EDIT_WRITE_TAIL_ITERATIONS,
  computeLoopIterationCap,
  shouldForceFinalIteration,
  shouldRejectTextOnlyFinal,
  shouldSkipTextOnlyGracefulFinal,
} from "../src/agent/core/loop-edit-write-tail";

async function main(): Promise<void> {
  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  assert.ok(loop.includes("loop-edit-write-tail"), "loop wires edit write tail");
  assert.ok(loop.includes("shouldRejectTextOnlyFinal"), "rejects text-only final");
  assert.ok(!loop.includes("buildWorkspaceScaffoldNudge"), "no scaffold nudge");

  const editState = createAgentLoopRunState("复刻首页写到当前项目");
  const max = 14;
  assert.equal(computeLoopIterationCap(max, editState), max + EDIT_WRITE_TAIL_ITERATIONS);
  assert.equal(shouldForceFinalIteration(max, max, editState), false);
  assert.equal(shouldForceFinalIteration(max + EDIT_WRITE_TAIL_ITERATIONS, max, editState), true);
  assert.equal(shouldRejectTextOnlyFinal(editState, max, max), true);
  assert.equal(shouldSkipTextOnlyGracefulFinal(editState), true);

  const readOnly = createAgentLoopRunState("只读分析，不要改代码");
  readOnly.likelyEditRequest = false;
  assert.equal(computeLoopIterationCap(max, readOnly), max);
  assert.equal(shouldSkipTextOnlyGracefulFinal(readOnly), false);

  console.log("validate-edit-write-tail: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

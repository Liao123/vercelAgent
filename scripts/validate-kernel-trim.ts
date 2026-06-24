/**
 * L7 内核 trim：runtime 不再拦截路由 / 末轮 recovery / scaffold 硬注入。
 *
 * 运行：npm run validate:kernel-trim
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  const runner = await read("src/agent/core/agent-loop-tool-runner.ts");
  const playbooks = await read("src/agent/core/task-playbooks.ts");
  const tail = await read("src/agent/core/loop-edit-write-tail.ts");
  const state = await read("src/agent/core/agent-loop-state.ts");

  assert.ok(!loop.includes("tryRecoverEditApproval"), "no edit recovery");
  assert.ok(!loop.includes("shouldRunFinalPrepareNudge"), "no final prepare nudge");
  assert.ok(!loop.includes("buildWorkspaceScaffoldNudge"), "no scaffold inject");
  assert.ok(!loop.includes("buildSoftRoundBudgetHint"), "no budget hint inject");
  assert.ok(!loop.includes("findCircuitBreaker"), "no circuit breaker");
  assert.ok(!loop.includes("findPlaybookToolRedirect"), "no playbook redirect");
  assert.ok(!runner.includes("evaluateToolEvidenceGate"), "no gather gate block");
  assert.ok(!runner.includes("findCircuitBreaker"), "runner no circuit breaker");

  assert.ok(!playbooks.includes("circuitBreakers"), "playbooks stripped breakers");
  assert.ok(!playbooks.includes("findCircuitBreaker"), "breaker fn removed");
  assert.ok(!playbooks.includes("findPlaybookToolRedirect"), "redirect fn removed");
  assert.ok(!playbooks.includes("buildSoftRoundBudgetHint"), "budget hint removed");

  assert.ok(!tail.includes("buildWorkspaceScaffoldNudge"), "scaffold fn removed");
  assert.ok(!tail.includes("shouldStopLoopAfterIteration"), "unused stop fn removed");
  assert.ok(tail.includes("shouldRejectTextOnlyFinal"), "keep final boundary");

  assert.ok(
    !state.includes("Deliverable satisfied. You may action=final"),
    "no auto-final cheer in checkpoint",
  );

  const reasoning = await read("src/agent/core/loop-reasoning.ts");
  const uiNudge = await read("src/agent/core/ui-prepare-nudge.ts");
  const evidenceGate = await read("src/agent/core/evidence-gate.ts");
  const evidencePolicy = await read("src/agent/core/evidence-gate-policy.ts");

  assert.ok(loop.includes("rebindPlaybookFromState"), "playbook rebind after reasoning");
  assert.ok(loop.includes("isLikelyCodeEditRequest"), "reasoning-aware edit detect");
  assert.ok(!loop.includes("skipReflection"), "no fake skip reflection");
  assert.ok(!loop.includes("openingReflection"), "no fake off-mode reflection");
  assert.ok(playbooks.includes("inferPlaybookIdFromReasoning"), "reasoning playbook bind");
  assert.ok(!evidenceGate.includes("evaluateToolEvidenceGate"), "gate sync-only");
  assert.ok(evidencePolicy.includes("evaluateToolEvidenceGate"), "policy holds validate gates");
  assert.ok(!uiNudge.includes('"新建 Agent", "Loop", "闭环"'), "no hardcoded UI labels default");
  assert.ok(!reasoning.includes("自适应跳过 JSON 推理轮"), "no skip fake reflection text");

  await assert.rejects(
    () => import("../src/agent/core/edit-recovery.ts"),
    /Cannot find module|ENOENT/,
  );
  await assert.rejects(
    () => import("../src/agent/core/final-prepare-nudge.ts"),
    /Cannot find module|ENOENT/,
  );

  console.log("validate-kernel-trim: passed");
}

main().catch((error) => {
  console.error("validate-kernel-trim failed:", error);
  process.exit(1);
});

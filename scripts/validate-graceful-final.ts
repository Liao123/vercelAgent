import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  assert.ok(loop.includes("attemptGracefulLoopFinal"), "graceful final call");
  assert.ok(loop.includes("forceFinalIteration"), "last iteration no tools");
  assert.ok(loop.includes("resolveTaskPlaybook"), "playbook routing");

  const runner = await read("src/agent/core/agent-loop-tool-runner.ts");
  assert.ok(runner.includes("emitPlaybookProgress"), "runner emits playbook progress");

  const state = await read("src/agent/core/agent-loop-state.ts");
  assert.ok(state.includes("toolFailureStreak"), "tool failure streak");

  console.log("validate-graceful-final: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

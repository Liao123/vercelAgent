/**
 * A149：单轮并行 gather smoke。
 *
 * 运行：npm run validate:parallel-gather
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  canParallelizeGatherBatch,
  isParallelGatherEnabled,
  PARALLEL_GATHER_TOOLS,
} from "../src/agent/core/parallel-gather";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  const prompt = await read("src/agent/prompts/loop-system-native.md");

  assert.ok(loop.includes("canParallelizeGatherBatch"), "loop uses parallel gather");
  assert.ok(loop.includes("Promise.all"), "loop parallelizes with Promise.all");
  assert.ok(prompt.includes("Parallel gather") || prompt.includes("multiple tool_calls"));

  assert.equal(isParallelGatherEnabled(), true);

  assert.ok(
    canParallelizeGatherBatch([
      { name: "file.read", args: { path: "src/app/layout.tsx" } },
      { name: "file.read", args: { path: "package.json" } },
    ]),
  );

  assert.equal(
    canParallelizeGatherBatch([
      { name: "file.read", args: { path: "package.json" } },
      { name: "file.read", args: { path: "package.json" } },
    ]),
    false,
    "duplicate read paths not parallel",
  );

  assert.equal(
    canParallelizeGatherBatch([
      { name: "file.read", args: { path: "a.ts" } },
      { name: "file.replace", args: { path: "a.ts", search: "x", replace: "y" } },
    ]),
    false,
    "mutation not parallel with gather",
  );

  assert.equal(
    canParallelizeGatherBatch([
      { name: "browser.inspect", args: {} },
      { name: "file.read", args: { path: "x.ts" } },
    ]),
    false,
    "browser not in parallel batch",
  );

  assert.equal(
    canParallelizeGatherBatch([{ name: "file.read", args: { path: "a.ts" } }]),
    false,
    "single tool not parallel",
  );

  assert.ok(PARALLEL_GATHER_TOOLS.has("file.read"));
  assert.ok(!PARALLEL_GATHER_TOOLS.has("file.replace"));

  console.log("validate-parallel-gather: passed");
}

main().catch((error) => {
  console.error("validate-parallel-gather failed:", error);
  process.exit(1);
});

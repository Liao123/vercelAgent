/**
 * A088：工作区目录树 API（无需 dev server）。
 */
import assert from "node:assert/strict";
import { listDirectory } from "../src/agent/tools/file-tools";

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const rootEntries = await listDirectory(rootPath, ".");
  assert.ok(rootEntries.length > 0, "root should have entries");
  assert.ok(
    rootEntries.some((e) => e.name === "src" && e.type === "directory"),
    "should list src/",
  );

  const srcEntries = await listDirectory(rootPath, "src/components");
  assert.ok(
    srcEntries.some((e) => e.path.includes("agent-composer.tsx")),
    "should list agent-composer under src/components",
  );

  let threw = false;
  try {
    await listDirectory(rootPath, "../../../etc");
  } catch {
    threw = true;
  }
  assert.ok(threw, "path escape should throw");

  console.log("validate-workspace-tree: passed", {
    rootCount: rootEntries.length,
    componentsCount: srcEntries.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

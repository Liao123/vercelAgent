import assert from "node:assert/strict";
import {
  ancestorDirsForFile,
  normalizeTreePath,
  treePathsEqual,
} from "../src/lib/workspace-tree-paths";

function main(): void {
  assert.equal(normalizeTreePath(".\\src\\a.ts"), "src/a.ts");
  assert.ok(treePathsEqual("src/a.ts", "./src/a.ts"));
  assert.deepEqual(ancestorDirsForFile("src/components/foo.tsx"), [
    ".",
    "src",
    "src/components",
  ]);
  assert.deepEqual(ancestorDirsForFile("README.md"), ["."]);
  console.log("validate-workspace-tree-paths: passed");
}

main();

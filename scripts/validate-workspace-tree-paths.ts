import assert from "node:assert/strict";
import {
  ancestorDirsForFile,
  normalizeTreePath,
  treePathsEqual,
  workspaceRelativePath,
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
  assert.equal(
    workspaceRelativePath(
      "D:/案例/aiproject/src/components/foo.tsx",
      "D:/案例/aiproject",
    ),
    "src/components/foo.tsx",
  );
  assert.equal(workspaceRelativePath("src/foo.ts", "D:/案例/aiproject"), "src/foo.ts");
  console.log("validate-workspace-tree-paths: passed");
}

main();

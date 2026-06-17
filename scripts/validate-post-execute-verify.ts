import assert from "node:assert/strict";
import {
  changedPathsFromFileMutation,
  changedPathsFromPatch,
  shouldRunPostExecuteVerification,
} from "../src/agent/verification/post-execute-verify";
import { filterLintablePaths } from "../src/agent/verification/verification-runner";

assert.equal(
  shouldRunPostExecuteVerification(["src/components/agent-composer.tsx"]),
  true,
);
assert.equal(shouldRunPostExecuteVerification(["README.md"]), false);

const filePaths = changedPathsFromFileMutation({
  type: "write",
  path: "src/app/page.tsx",
});
assert.deepEqual(filePaths, ["src/app/page.tsx"]);

const patchPaths = changedPathsFromPatch([
  {
    changed: true,
    oldPath: "src/a.tsx",
    newPath: "src/a.tsx",
  },
  {
    changed: false,
    oldPath: "src/b.tsx",
    newPath: "src/b.tsx",
  },
]);
assert.deepEqual(patchPaths, ["src/a.tsx"]);

assert.deepEqual(
  filterLintablePaths([
    "src/a.tsx",
    "README.md",
    "src/b.ts",
    "src/c.tsx",
    "src/a.tsx",
  ]),
  ["src/a.tsx", "src/b.ts", "src/c.tsx"],
);
assert.deepEqual(filterLintablePaths(["README.md"]), []);

console.log("validate-post-execute-verify: passed");

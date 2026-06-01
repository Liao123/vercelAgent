import assert from "node:assert/strict";
import {
  changedPathsFromFileMutation,
  changedPathsFromPatch,
  shouldRunPostExecuteVerification,
} from "../src/agent/verification/post-execute-verify";

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

console.log("validate-post-execute-verify: passed");

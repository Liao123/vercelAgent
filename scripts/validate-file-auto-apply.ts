/**
 * A093：自动应用文件变更策略（无需 UI）。
 */
import assert from "node:assert/strict";
import {
  canAutoApplyFileApproval,
  readAutoApplyFileChanges,
} from "../src/lib/agent-file-auto-apply";

const fileLow = {
  status: "pending" as const,
  risk: "low" as const,
  details: {
    kind: "file_mutation" as const,
    operationHash: "h",
    operation: { type: "write" as const, path: "a.ts", content: "" },
    preview: { path: "a.ts", content: "" },
  },
};

const fileHigh = { ...fileLow, risk: "high" as const };

const shell = {
  status: "pending" as const,
  risk: "medium" as const,
  details: {
    kind: "shell_command" as const,
    operationHash: "h",
    operation: { type: "npm_script" as const, script: "lint" as const },
    preview: { script: "lint", command: "npm run lint" },
  },
};

assert.equal(canAutoApplyFileApproval(fileLow, false), false);
assert.equal(canAutoApplyFileApproval(fileLow, true), true);

assert.equal(typeof readAutoApplyFileChanges, "function");
assert.equal(canAutoApplyFileApproval(fileHigh, true), false);
assert.equal(canAutoApplyFileApproval(shell, true), false);

console.log("validate-file-auto-apply: passed");

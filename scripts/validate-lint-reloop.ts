/**
 * A090：lint 失败后生成再 Loop 的预填文案。
 */
import assert from "node:assert/strict";
import {
  buildLintFixLoopRequest,
  isPostExecuteFixContinuation,
  readAutoReloopOnLintFail,
  shouldOfferLintReloop,
} from "../src/lib/agent-lint-reloop";
import type { PostExecuteVerification } from "../src/agent/verification/post-execute-verify";

const failed: PostExecuteVerification = {
  triggered: true,
  success: false,
  changedPaths: ["src/components/agent-composer.tsx"],
  results: [
    {
      command: "lint",
      success: false,
      output: "error TS1000: mock failure",
      completedAt: new Date().toISOString(),
    },
  ],
  summary: "执行后验证失败：lint",
  completedAt: new Date().toISOString(),
};

assert.equal(shouldOfferLintReloop(failed), true);
assert.equal(shouldOfferLintReloop({ ...failed, success: true }), false);

const request = buildLintFixLoopRequest(failed);
assert.ok(request.includes("agent-composer"));
assert.ok(request.includes("mock failure"));
assert.ok(request.includes("file.replace.prepare"));

assert.equal(typeof readAutoReloopOnLintFail, "function");
assert.equal(
  isPostExecuteFixContinuation(
    "上一轮写盘后的 lint/typecheck 未通过，请修复",
  ),
  true,
);
assert.equal(
  isPostExecuteFixContinuation("把这个首页的新建 Agent 前面的加号去掉"),
  false,
);

console.log("validate-lint-reloop: passed");

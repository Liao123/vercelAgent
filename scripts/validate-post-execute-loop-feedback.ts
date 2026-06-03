/**
 * A086：上一轮 post-execute 失败应进入 Loop checkpoint。
 *
 * 运行：npm run validate:post-execute-loop-feedback
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRuntimeCheckpoint,
  createAgentLoopRunState,
} from "../src/agent/core/agent-loop-state";
import {
  formatPostExecuteFeedbackBlock,
  persistPostExecuteVerification,
  postExecuteFeedbackFromStored,
  type PostExecuteVerification,
} from "../src/agent/verification/post-execute-verify";

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vec-post-exec-"));
  const verification: PostExecuteVerification = {
    triggered: true,
    changedPaths: ["src/components/agent-composer.tsx"],
    results: [
      {
        command: "lint",
        success: false,
        output: "error TS1000: mock lint failure at line 42",
        durationMs: 1200,
      },
    ],
    success: false,
    summary: "执行后验证失败：lint。请在下一轮 Loop 中修复 stderr 后重新 prepare（不会自动改代码）。",
    completedAt: new Date().toISOString(),
  };

  await persistPostExecuteVerification(root, {
    taskId: "task_mock",
    approvalId: "approval_mock",
    verification,
  });

  const raw = JSON.parse(
    await fs.readFile(
      path.join(root, ".agent-state/post-execute-verify.json"),
      "utf8",
    ),
  ) as { taskId: string; approvalId: string; verification: PostExecuteVerification };

  const feedback = postExecuteFeedbackFromStored(raw);
  assert.ok(feedback, "should build feedback from failed verification");
  assert.equal(feedback?.failedCommand, "lint");
  assert.ok(feedback?.outputSnippet?.includes("mock lint failure"));

  const state = createAgentLoopRunState("修复刚才 lint 报错");
  state.postExecuteFeedback = feedback!;
  const checkpoint = buildRuntimeCheckpoint(state);
  assert.ok(checkpoint.includes("Post-execute verification failed"));
  assert.ok(checkpoint.includes("mock lint failure"));
  assert.ok(
    formatPostExecuteFeedbackBlock(feedback!).includes("npm run lint"),
  );

  await fs.rm(root, { recursive: true, force: true });
  console.log("validate-post-execute-loop-feedback: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

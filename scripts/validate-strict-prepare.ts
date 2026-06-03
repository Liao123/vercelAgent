/**
 * A089：strictPrepare 时禁止 edit.recovery。
 */
import assert from "node:assert/strict";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import { tryRecoverEditApproval } from "../src/agent/core/edit-recovery";

async function main(): Promise<void> {
  const state = createAgentLoopRunState("把首页左边的 Loop 选择去掉");
  state.strictPrepare = true;
  state.toolsCalled.push("ui.trace_from_page");
  state.filesRead.push("src/components/agent-composer.tsx");

  const result = await tryRecoverEditApproval({
    rootPath: process.cwd(),
    taskId: "task_strict_test",
    userRequest: state.userRequest,
    filesRead: state.filesRead,
    skipRecovery: state.strictPrepare === true,
  });

  assert.equal(result, null, "strict mode must skip recovery entirely");
  console.log("validate-strict-prepare: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

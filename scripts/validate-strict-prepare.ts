/**
 * strictPrepare 时 prepare 门禁仍生效（edit.recovery 已移除）。
 */
import assert from "node:assert/strict";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import { assertPrepareGate } from "../src/agent/core/prepare-gate";

async function main(): Promise<void> {
  const state = createAgentLoopRunState("修改 src/app/page.tsx 标题");
  state.strictPrepare = true;

  assert.throws(
    () =>
      assertPrepareGate({
        toolName: "file.replace.prepare",
        requiredReadPaths: ["src/app/page.tsx"],
        runState: state,
        enforce: true,
      }),
    /须先 file.read/,
  );

  state.filesRead.push("src/app/page.tsx");
  assert.doesNotThrow(() =>
    assertPrepareGate({
      toolName: "file.replace.prepare",
      requiredReadPaths: ["src/app/page.tsx"],
      runState: state,
      enforce: true,
    }),
  );

  console.log("validate-strict-prepare: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

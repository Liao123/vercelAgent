/**
 * A165 Loop 任务取消 wiring（无需 LLM / dev server）。
 *
 * 运行：npm run validate:loop-cancel
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  LOOP_USER_CANCEL_MESSAGE,
  isLoopCancelledError,
  LoopCancelledError,
  throwIfLoopCancelled,
} from "../src/agent/core/loop-cancel";

async function main(): Promise<void> {
  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  const panel = await fs.readFile("src/components/agent-panel.tsx", "utf8");
  const route = await fs.readFile("src/app/api/agent/loop/route.ts", "utf8");
  const composer = await fs.readFile("src/components/agent-composer.tsx", "utf8");
  const types = await fs.readFile("src/agent/types.ts", "utf8");

  assert.ok(types.includes('"task.cancelled"'), "types define task.cancelled");
  assert.ok(loop.includes("finishLoopCancelled"), "loop handles cancel finish");
  assert.ok(loop.includes("input.signal?.aborted"), "loop checks abort signal");
  assert.ok(loop.includes("signal?: AbortSignal"), "loop input accepts signal");
  assert.ok(route.includes("request.signal"), "route passes request.signal");
  assert.ok(route.includes("isLoopCancelledError"), "route handles cancel error");
  assert.ok(panel.includes("loopAbortRef"), "panel keeps abort controller ref");
  assert.ok(panel.includes("cancelRunningLoop"), "panel exposes cancel handler");
  assert.ok(panel.includes("signal: loopAbortController.signal"), "panel aborts fetch");
  assert.ok(composer.includes("onCancel"), "composer accepts onCancel");
  assert.ok(composer.includes("停止运行"), "composer stop button title");

  assert.equal(LOOP_USER_CANCEL_MESSAGE, "用户已停止运行");

  const controller = new AbortController();
  controller.abort();
  assert.throws(() => throwIfLoopCancelled(controller.signal), LoopCancelledError);
  assert.ok(isLoopCancelledError(new LoopCancelledError()));

  console.log("validate-loop-cancel: passed");
}

main().catch((error) => {
  console.error("validate-loop-cancel failed:", error);
  process.exit(1);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildModelFailureContinueNudge,
  isRuntimeReflectionEnabled,
  MAX_CONSECUTIVE_MODEL_FAILURES,
} from "../src/agent/core/loop-model-failure";
import { formatModelErrorMessage } from "../src/lib/model-error-message";
import { resolveTaskPlaybook } from "../src/agent/core/task-playbooks";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import { failedAgentLoopPlan, createAgentLoopPlan } from "../src/agent/core/agent-loop-plan";

async function main(): Promise<void> {
  assert.equal(isRuntimeReflectionEnabled(), false);
  process.env.AGENT_RUNTIME_REFLECTION = "1";
  assert.equal(isRuntimeReflectionEnabled(), true);
  delete process.env.AGENT_RUNTIME_REFLECTION;

  assert.equal(MAX_CONSECUTIVE_MODEL_FAILURES, 3);

  const nudge = buildModelFailureContinueNudge({
    error: new Error("HTTP 502 bad gateway"),
    playbookTitle: "Demo 页面复刻",
    openingPlannedNext: "browser.open → extract",
    userRequest: "复刻首页",
  });
  assert.ok(nudge.includes("继续用工具推进"));
  assert.ok(nudge.includes("复刻首页"));
  assert.ok(!nudge.includes("任务已暂停"));

  const html = `<!DOCTYPE html><title>524: timeout</title><h1>Error</h1>`;
  const msg = formatModelErrorMessage(html);
  assert.ok(msg.includes("HTML 错误页"));
  assert.ok(!msg.includes("API 中转超时"));

  const replicateState = createAgentLoopRunState("复刻首页 http://example.com/");
  replicateState.taskReasoning = {
    understanding: "复刻首页",
    intent: "code_edit",
    risk: "write",
    evidenceNeeded: [],
    planSteps: ["browser.open", "write page"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "extract and write",
    source: "model",
  };
  const pb = resolveTaskPlaybook(replicateState.userRequest, replicateState);
  assert.equal(pb.id, "design-replicate");

  const plan = createAgentLoopPlan("test");
  const failed = failedAgentLoopPlan(plan);
  assert.equal(failed.steps.find((s) => s.id === "finish")?.status, "blocked");

  const loop = await fs.readFile("src/agent/model/chat-completions-provider.ts", "utf8");
  assert.ok(
    loop.includes("serializeAgentMessagesForOpenAiApi(input.messages)"),
    "stream uses serialized messages",
  );

  const gen = await fs.readFile("src/agent/core/loop-model-generate.ts", "utf8");
  assert.ok(gen.includes("reasoningTurn"), "reasoning uses non-stream path");

  console.log("validate-loop-model-failure: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * 运行中用户引导（Cursor steering）wiring。
 *
 * 运行：npm run validate:loop-guidance
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  GuidanceNotAcceptedError,
  applyPendingUserGuidance,
  beginAgentLoopSession,
  beginGuidanceModelInterrupt,
  buildUserGuidanceMessage,
  enqueueUserGuidance,
  endGuidanceModelInterrupt,
  interruptActiveModelForGuidance,
  isGuidanceModelInterrupt,
  submitUserGuidance,
} from "../src/agent/core/loop-user-guidance";
import type { AgentEvent, AgentMessage } from "../src/agent/types";

async function main(): Promise<void> {
  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  const guidanceModule = await fs.readFile(
    "src/agent/core/loop-user-guidance.ts",
    "utf8",
  );
  const route = await fs.readFile(
    "src/app/api/agent/guidance/route.ts",
    "utf8",
  );
  const panel = await fs.readFile("src/components/agent-panel.tsx", "utf8");
  const composer = await fs.readFile(
    "src/components/agent-composer.tsx",
    "utf8",
  );
  const types = await fs.readFile("src/agent/types.ts", "utf8");
  const httpServer = await fs.readFile(
    "src/agent-server/http-server.ts",
    "utf8",
  );
  const remote = await fs.readFile("src/agent-server/remote-loop.ts", "utf8");
  const feed = await fs.readFile("src/lib/agent-turn-feed.ts", "utf8");
  const steps = await fs.readFile("src/lib/agent-reasoning-steps.ts", "utf8");

  assert.ok(types.includes('"guidance.received"'), "types define guidance.received");
  assert.ok(guidanceModule.includes("beginAgentLoopSession"), "session registry");
  assert.ok(
    guidanceModule.includes("interruptActiveModelForGuidance"),
    "guidance can interrupt active model",
  );
  assert.ok(
    guidanceModule.includes("beginGuidanceModelInterrupt"),
    "model interrupt controller registry",
  );
  assert.ok(guidanceModule.includes("applyPendingUserGuidance"), "drain helper");
  assert.ok(loop.includes("applyPendingUserGuidance"), "loop drains guidance");
  assert.ok(loop.includes("beginAgentLoopSession"), "loop registers session");
  assert.ok(loop.includes("beginGuidanceModelInterrupt"), "loop arms guidance interrupt");
  assert.ok(loop.includes("isGuidanceModelInterrupt"), "loop recognizes guidance abort");
  assert.ok(loop.includes("modelInterruptedForGuidance"), "loop restarts after steer");
  assert.ok(route.includes("submitUserGuidance"), "guidance API");
  assert.ok(route.includes("interruptActiveModelForGuidance"), "guidance API interrupts");
  assert.ok(route.includes("interrupted"), "guidance API returns interrupt state");
  assert.ok(httpServer.includes('"/guidance"'), "agent-server guidance route");
  assert.ok(remote.includes("proxyAgentGuidanceToServer"), "remote guidance proxy");
  assert.ok(panel.includes("sendGuidance"), "panel sends guidance");
  assert.ok(panel.includes("/api/agent/guidance"), "panel guidance fetch");
  assert.ok(panel.includes("data.interrupted"), "panel reports interrupt status");
  assert.ok(panel.includes("setApprovalStatus"), "panel updates guidance status");
  assert.ok(composer.includes("onSendGuidance"), "composer guidance prop");
  assert.ok(composer.includes("运行中可追加引导"), "composer running placeholder");
  assert.ok(feed.includes('"guidance.received"'), "narrative includes guidance");
  assert.ok(steps.includes('"guidance.received"'), "timeline groups guidance");

  assert.ok(
    buildUserGuidanceMessage("先写 index.html").includes("[USER_GUIDANCE]"),
    "guidance message tag",
  );

  const endSession = beginAgentLoopSession("thread_test");
  const guidanceController = beginGuidanceModelInterrupt("thread_test");
  const item = submitUserGuidance("thread_test", "  优先写页面  ");
  assert.equal(item.text, "优先写页面");

  assert.equal(interruptActiveModelForGuidance("thread_test"), true);
  assert.ok(isGuidanceModelInterrupt(guidanceController.signal));
  endGuidanceModelInterrupt("thread_test", guidanceController);

  const messages: AgentMessage[] = [];
  const events: AgentEvent[] = [];
  applyPendingUserGuidance({
    threadId: "thread_test",
    taskId: "task_test",
    messages,
    emit: (event) => events.push(event),
  });

  assert.equal(messages.length, 1);
  assert.ok(messages[0]!.content.includes("优先写页面"));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, "guidance.received");
  if (events[0]!.type === "guidance.received") {
    assert.equal(events[0]!.applied, true);
  }

  endSession();
  assert.throws(
    () => submitUserGuidance("thread_test", "late"),
    GuidanceNotAcceptedError,
  );

  beginAgentLoopSession("thread_q");
  enqueueUserGuidance("thread_q", "a");
  enqueueUserGuidance("thread_q", "b");
  const messages2: AgentMessage[] = [];
  applyPendingUserGuidance({
    threadId: "thread_q",
    taskId: "task_q",
    messages: messages2,
    emit: () => {},
  });
  assert.equal(messages2.length, 2);

  console.log("validate-loop-guidance: passed");
}

main().catch((error) => {
  console.error("validate-loop-guidance failed:", error);
  process.exit(1);
});

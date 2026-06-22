/**
 * 会话续聊 + uiContext 注入 smoke（无需 LLM / dev server）。
 *
 * 运行：npm run validate:session-continuity
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildThreadMemoryAfterTask,
} from "../src/agent/memory/loop-context-compactor";
import {
  buildThreadMemoryInjectionMessage,
  deleteThreadMemory,
  getThreadMemory,
  saveThreadMemory,
} from "../src/agent/memory/thread-memory-store";
import {
  resolveTaskPlaybook,
} from "../src/agent/core/task-playbooks";
import {
  buildOpenEditorUiContext,
  describeUiContextForPrompt,
  mergeBrowserTabIntoUiContext,
} from "../src/agent/indexer/ui-layout-boost";

const THREAD_ID = "thread_validate_session_continuity";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const loopRoute = await read("src/app/api/agent/loop/route.ts");
  const loop = await read("src/agent/core/agent-loop.ts");
  const panel = await read("src/components/agent-panel.tsx");

  assert.ok(loop.includes("buildThreadMemoryAfterTask"), "task end saves thread memory");
  assert.ok(loop.includes("evaluateReasoningTurn"), "adaptive reasoning turn");
  assert.ok(loopRoute.includes("browserActiveTab"), "loop API passes browser tab");
  assert.ok(loopRoute.includes("openEditorPaths"), "loop API passes open editor paths");
  assert.ok(panel.includes("mergeBrowserTabIntoUiContext"), "panel injects browser tab");
  assert.ok(panel.includes("/api/agent/browser/tabs"), "panel reads browser tabs");

  assert.equal(
    resolveTaskPlaybook("这个网站的标题是什么").id,
    "default",
    "ambiguous site question uses default playbook not hard route",
  );
  assert.equal(
    resolveTaskPlaybook("我上一个问题是什么").id,
    "default",
    "meta follow-up uses default playbook not hard route",
  );

  const turn1 = buildThreadMemoryAfterTask({
    messages: [
      { role: "system", content: "agent" },
      { role: "user", content: "这个网站的标题是什么" },
      { role: "assistant", content: "标题是：百度一下，你就知道" },
    ],
    userRequest: "这个网站的标题是什么",
    summary: "标题是：百度一下，你就知道",
    compactRound: 0,
  });
  saveThreadMemory({
    threadId: THREAD_ID,
    workspaceId: "ws_validate",
    summaryId: "summary_turn1",
    memoryContent: turn1.memoryContent,
    round: turn1.round,
    method: turn1.method,
    updatedAt: new Date().toISOString(),
    lastTaskId: "task_turn1",
    lastUserRequest: "这个网站的标题是什么",
    title: "网站标题",
    summaryPreview: turn1.summaryPreview,
  });

  const stored = getThreadMemory(THREAD_ID);
  assert.ok(stored?.memoryContent.includes("这个网站的标题是什么"));
  const injection = buildThreadMemoryInjectionMessage(stored!.memoryContent);
  assert.ok(injection.content.includes("[THREAD_MEMORY]"));

  const turn2 = buildThreadMemoryAfterTask({
    messages: [
      { role: "system", content: "agent" },
      injection,
      { role: "user", content: "我上一个问题是什么" },
      { role: "assistant", content: "你上一个问题是：这个网站的标题是什么。" },
    ],
    userRequest: "我上一个问题是什么",
    summary: "你上一个问题是：这个网站的标题是什么。",
    priorMemoryContent: stored!.memoryContent,
    compactRound: 0,
  });
  assert.ok(turn2.memoryContent.includes("这个网站的标题是什么"));
  assert.ok(turn2.memoryContent.includes("我上一个问题是什么"));

  const uiPrompt = describeUiContextForPrompt(
    mergeBrowserTabIntoUiContext(buildOpenEditorUiContext({ layout: "triple" }), {
      url: "https://www.baidu.com/",
      title: "百度一下，你就知道",
    }),
  );
  assert.ok(uiPrompt.includes("Embedded browser tab"));
  assert.ok(uiPrompt.includes("disambiguate"), "neutral disambiguation hint");

  deleteThreadMemory(THREAD_ID);
  console.log("validate-session-continuity: passed");
}

main().catch((error) => {
  console.error("validate-session-continuity failed:", error);
  process.exit(1);
});

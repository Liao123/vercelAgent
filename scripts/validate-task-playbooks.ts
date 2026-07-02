import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  computePlaybookProgress,
  detectPlaybookIdFromRequest,
  getPlaybookById,
  inferPlaybookIdFromReasoning,
  isBrowserDocAnalysisRequest,
  isCapabilityExtensionRequest,
  isDesignReplicateRequest,
  isDevRunRequest,
  isScreenshotSaveRequest,
  collectPlaybookAcceleratorHints,
  resolveTaskPlaybook,
} from "../src/agent/core/task-playbooks";
import type { TaskReasoning } from "../src/agent/core/loop-reasoning";
import { GOLDEN_UI_QUERY, GOLDEN_DESIGN_REPLICATE_QUERY } from "./golden-path-fixtures";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

function withReasoning(
  userRequest: string,
  partial: Partial<TaskReasoning> & Pick<TaskReasoning, "intent" | "risk">,
): ReturnType<typeof createAgentLoopRunState> {
  const state = createAgentLoopRunState(userRequest);
  state.taskReasoning = {
    understanding: partial.understanding ?? userRequest,
    intent: partial.intent,
    risk: partial.risk,
    evidenceNeeded: partial.evidenceNeeded ?? [],
    planSteps: partial.planSteps ?? [],
    ambiguity: partial.ambiguity ?? null,
    canAnswerNow: partial.canAnswerNow ?? false,
    plannedNext: partial.plannedNext ?? "推进",
    source: "model",
  };
  return state;
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  const runner = await read("src/agent/core/agent-loop-tool-runner.ts");
  const feed = await read("src/lib/agent-turn-feed.ts");
  const playbooks = await read("src/agent/core/task-playbooks.ts");

  assert.ok(loop.includes("playbook.matched"), "loop emits playbook.matched");
  assert.ok(loop.includes("playbook.progress"), "loop emits playbook.progress");
  assert.ok(loop.includes("resolveTaskPlaybook"), "loop uses resolveTaskPlaybook");
  assert.ok(loop.includes("rebindPlaybookFromState"), "loop rebinds after reasoning");
  assert.ok(runner.includes("emitPlaybookProgress"), "runner emits progress");
  assert.ok(!runner.includes("findCircuitBreaker"), "runner no circuit breakers");
  assert.ok(!playbooks.includes("circuitBreakers"), "no circuit breaker data");
  assert.ok(!playbooks.includes("findPlaybookToolRedirect"), "no tool redirect");
  assert.ok(playbooks.includes("inferPlaybookIdFromReasoning"), "reasoning playbook bind");
  assert.ok(feed.includes("extractPlaybookFromEvents"), "feed extracts playbook");

  const docUrl =
    "https://s.apifox.cn/aed7ded5-e044-4fc8-8c17-811dd6b0f909/469140751e0";
  const docRequest = `帮我解析 ${docUrl} 的接口参数`;
  assert.ok(isBrowserDocAnalysisRequest(docRequest), "browser doc detect");
  assert.equal(detectPlaybookIdFromRequest(docRequest), "browser-doc");
  const docState = withReasoning(docRequest, {
    intent: "browser",
    risk: "read_only",
  });
  assert.equal(resolveTaskPlaybook(docRequest, docState).id, "browser-doc");

  assert.ok(
    isDesignReplicateRequest(GOLDEN_DESIGN_REPLICATE_QUERY),
    "design replicate detect",
  );
  assert.ok(
    isDesignReplicateRequest("这个项目帮我复刻一下百度网站进来 只需要首页"),
    "named homepage replicate detect without URL",
  );
  const replicateState = withReasoning(GOLDEN_DESIGN_REPLICATE_QUERY, {
    intent: "code_edit",
    risk: "write",
  });
  assert.equal(
    resolveTaskPlaybook(GOLDEN_DESIGN_REPLICATE_QUERY, replicateState).id,
    "design-replicate",
  );
  const namedReplicateState = withReasoning(
    "这个项目帮我复刻一下百度网站进来 只需要首页",
    {
      intent: "code_edit",
      risk: "write",
    },
  );
  assert.equal(
    resolveTaskPlaybook(namedReplicateState.userRequest, namedReplicateState).id,
    "design-replicate",
  );

  assert.ok(
    isCapabilityExtensionRequest(
      "给 Agent 加 shell.run 终端能力，改 src/agent/core/agent-loop-tools.ts",
    ),
    "capability extension detect",
  );
  const extState = withReasoning(
    "扩展 Agent 命令行能力，对齐 Cursor，改 agent-loop-tools 并跑 validate:shell-run",
    { intent: "code_edit", risk: "write" },
  );
  assert.equal(resolveTaskPlaybook(extState.userRequest, extState).id, "capability-extension");

  assert.ok(isDevRunRequest("跑一下 dev 能跑吗"), "dev run detect");
  const devState = withReasoning("跑一下 dev能跑吗", {
    intent: "shell",
    risk: "write",
  });
  assert.equal(resolveTaskPlaybook("跑一下 dev能跑吗", devState).id, "dev-run");

  assert.ok(
    isScreenshotSaveRequest("把当前页面截图保存到桌面 desktop:test.jpg"),
    "screenshot save detect",
  );
  const shotState = withReasoning("截图到桌面保存为 test.jpg", {
    intent: "code_edit",
    risk: "write",
  });
  assert.equal(resolveTaskPlaybook("截图到桌面保存为 test.jpg", shotState).id, "screenshot-save");

  const uiState = withReasoning(GOLDEN_UI_QUERY, {
    intent: "code_edit",
    risk: "write",
  });
  assert.equal(resolveTaskPlaybook(GOLDEN_UI_QUERY, uiState).id, "ui-visible-edit");

  const readOnly = resolveTaskPlaybook("只读分析 src/app/page.tsx，不要改代码");
  assert.equal(readOnly.id, "read-only-audit");

  assert.equal(
    resolveTaskPlaybook("这个网站的标题是什么").id,
    "default",
    "bootstrap stays default until reasoning",
  );
  assert.equal(
    inferPlaybookIdFromReasoning(
      {
        understanding: "问标题",
        intent: "qa",
        risk: "read_only",
        evidenceNeeded: [],
        planSteps: [],
        ambiguity: null,
        canAnswerNow: false,
        plannedNext: "read",
        source: "model",
      },
      "这个网站的标题是什么",
    ),
    "default",
  );

  const hints = collectPlaybookAcceleratorHints(
    "只读分析 src/app/page.tsx，不要改代码",
  );
  assert.ok(hints.length > 0, "accelerator hints collected");

  const uiPb = getPlaybookById("ui-visible-edit");
  const progress = computePlaybookProgress(uiPb, [
    "ui.trace_from_page",
    "jsx.find_text",
  ]);
  assert.equal(progress.completedCount, 2);
  assert.ok(progress.progressLabel.includes("界面"));

  console.log("validate-task-playbooks: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

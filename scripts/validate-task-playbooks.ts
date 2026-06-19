import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  computePlaybookProgress,
  findCircuitBreaker,
  isBrowserDocAnalysisRequest,
  isCapabilityExtensionRequest,
  isDesignReplicateRequest,
  resolveTaskPlaybook,
} from "../src/agent/core/task-playbooks";
import { GOLDEN_UI_QUERY, GOLDEN_DESIGN_REPLICATE_QUERY } from "./golden-path-fixtures";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  const runner = await read("src/agent/core/agent-loop-tool-runner.ts");
  const feed = await read("src/lib/agent-turn-feed.ts");

  assert.ok(loop.includes("playbook.matched"), "loop emits playbook.matched");
  assert.ok(loop.includes("playbook.progress"), "loop emits playbook.progress");
  assert.ok(loop.includes("resolveTaskPlaybook"), "loop uses resolveTaskPlaybook");
  assert.ok(runner.includes("findCircuitBreaker"), "runner uses circuit breakers");
  assert.ok(runner.includes("emitPlaybookProgress"), "runner emits progress");
  assert.ok(feed.includes("extractPlaybookFromEvents"), "feed extracts playbook");
  assert.ok(feed.includes("filterNarrativeEvents"), "feed filters duplicate started");

  const docUrl =
    "https://s.apifox.cn/aed7ded5-e044-4fc8-8c17-811dd6b0f909/469140751e0";
  const docRequest = `帮我解析 ${docUrl} 的接口参数`;
  assert.ok(isBrowserDocAnalysisRequest(docRequest), "browser doc detect");
  const docPb = resolveTaskPlaybook(docRequest);
  assert.equal(docPb.id, "browser-doc");

  assert.ok(
    isDesignReplicateRequest(GOLDEN_DESIGN_REPLICATE_QUERY),
    "design replicate detect",
  );
  const replicatePb = resolveTaskPlaybook(GOLDEN_DESIGN_REPLICATE_QUERY);
  assert.equal(replicatePb.id, "design-replicate");

  assert.ok(
    isCapabilityExtensionRequest(
      "给 Agent 加 shell.run 终端能力，改 src/agent/core/agent-loop-tools.ts",
    ),
    "capability extension detect",
  );
  const extPb = resolveTaskPlaybook(
    "扩展 Agent 命令行能力，对齐 Cursor，改 agent-loop-tools 并跑 validate:shell-run",
  );
  assert.equal(extPb.id, "capability-extension");

  const uiPb = resolveTaskPlaybook(GOLDEN_UI_QUERY);
  assert.equal(uiPb.id, "ui-visible-edit");

  const readOnly = resolveTaskPlaybook("只读分析 src/app/page.tsx，不要改代码");
  assert.equal(readOnly.id, "read-only-audit");

  const progress = computePlaybookProgress(uiPb, [
    "ui.trace_from_page",
    "jsx.find_text",
  ]);
  assert.equal(progress.completedCount, 2);
  assert.ok(progress.progressLabel.includes("界面"));

  const breaker = findCircuitBreaker(
    docPb,
    "devtools.get_network_requests",
    { tool: "devtools.get_network_requests", count: 2 },
  );
  assert.ok(breaker?.redirectTool === "browser.inspect");

  const uiState = createAgentLoopRunState(GOLDEN_UI_QUERY);
  uiState.toolFailureStreak = {
    tool: "file.search",
    error: "empty",
    count: 2,
  };
  const uiBreaker = findCircuitBreaker(
    resolveTaskPlaybook(GOLDEN_UI_QUERY, uiState),
    "file.search",
    uiState.toolFailureStreak,
  );
  assert.ok(uiBreaker?.redirectTool === "jsx.find_text");

  console.log("validate-task-playbooks: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * A153 framework metadata catalog + A154 model resilience smoke。
 *
 * 运行：npm run validate:generic-capability
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  formatMetadataCatalogHints,
  hasMetadataRoleInPaths,
  pathMatchesMetadataRole,
  resolveMetadataProfile,
} from "../src/agent/workspace/framework-metadata-catalog";
import { formatRuntimeFactsForPrompt } from "../src/agent/workspace/runtime-facts-prompt";
import {
  hasPageTitleMetadataEvidence,
  isNarrowWorkspaceMetadataEvidenceComplete,
} from "../src/agent/core/evidence-gate";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import {
  isRetriableModelError,
  withModelCallRetry,
} from "../src/lib/model-call-resilience";
import { formatModelErrorMessage } from "../src/lib/model-error-message";
import { isNoisyRuntimeReflection } from "../src/lib/agent-reasoning-steps";

async function main(): Promise<void> {
  const gate = await fs.readFile("src/agent/core/evidence-gate.ts", "utf8");
  const provider = await fs.readFile(
    "src/agent/model/chat-completions-provider.ts",
    "utf8",
  );
  const loopGen = await fs.readFile("src/agent/core/loop-model-generate.ts", "utf8");

  assert.ok(gate.includes("framework-metadata-catalog"), "gate uses catalog");
  assert.ok(!gate.includes("LAYOUT_METADATA_PATH"), "no hardcoded layout regex in gate");
  assert.ok(provider.includes("extractAssistantText"), "provider imports extractAssistantText");
  assert.ok(loopGen.includes("withModelCallRetry"), "loop model uses retry");

  assert.ok(resolveMetadataProfile("Next.js")?.id === "next");
  assert.ok(resolveMetadataProfile("Vue")?.id === "vue");
  assert.ok(
    pathMatchesMetadataRole("src/app/layout.tsx", "page_title", "Next.js"),
  );
  assert.ok(pathMatchesMetadataRole("index.html", "page_title", "Vue"));
  assert.ok(pathMatchesMetadataRole("package.json", "package_name", "Vue"));

  const nextState = createAgentLoopRunState("标题");
  nextState.workspaceFramework = "Next.js";
  nextState.filesRead.push("src/app/layout.tsx", "package.json");
  assert.ok(hasPageTitleMetadataEvidence(nextState));

  const vueState = createAgentLoopRunState("网站项目的标题是什么");
  vueState.workspaceFramework = "Vue";
  vueState.taskReasoning = {
    understanding: "问站点标题",
    intent: "qa",
    risk: "read_only",
    evidenceNeeded: ["metadata"],
    planSteps: [],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "read",
    source: "model",
  };
  vueState.filesRead.push("index.html", "package.json");
  assert.ok(isNarrowWorkspaceMetadataEvidenceComplete(vueState));

  assert.ok(formatMetadataCatalogHints("Next.js").includes("layout"));
  assert.ok(formatRuntimeFactsForPrompt(new Date("2026-06-22T12:00:00+08:00")).includes("2026"));

  assert.ok(
    isRetriableModelError(new Error("API 中转超时（524）")),
  );
  let attempts = 0;
  const result = await withModelCallRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("524 timeout");
      return "ok";
    },
    { maxRetries: 1, delayMs: 0 },
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 2);

  const html = formatModelErrorMessage(
    "OpenAI 兼容中转 API error: <!DOCTYPE html><title>524: timeout</title>",
  );
  assert.ok(html.includes("524"));
  assert.ok(!html.includes("<!DOCTYPE"));

  assert.ok(
    isNoisyRuntimeReflection({
      understanding: "继续执行（第 2/12 轮）",
      blockers: [],
      plannedNext: "继续",
      source: "runtime",
    }),
  );
  assert.ok(
    !isNoisyRuntimeReflection({
      understanding: "模型调用失败，任务已暂停。",
      blockers: ["API 超时"],
      plannedNext: "重试",
      source: "runtime",
    }),
  );

  assert.ok(
    hasMetadataRoleInPaths(["index.html"], "page_title", "Vite"),
  );

  console.log("validate-generic-capability: passed");
}

main().catch((error) => {
  console.error("validate-generic-capability failed:", error);
  process.exit(1);
});

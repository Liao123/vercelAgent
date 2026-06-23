/**
 * 首轮结构化推理 + 证据门槛 smoke（无需 LLM）。
 *
 * 运行：npm run validate:loop-reasoning
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildAdaptiveReasoningSkipHint,
  buildPostReasoningHint,
  buildReasoningTurnUserMessage,
  evaluateReasoningTurn,
  isMetaExplainRequest,
  looksComplexTask,
  normalizeTaskReasoning,
  parseTaskReasoning,
  shouldRunReasoningTurn,
} from "../src/agent/core/loop-reasoning";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import {
  evaluateFinalEvidenceGate,
  evaluateToolEvidenceGate,
  hasLayoutMetadataEvidence,
  hasPackageNameEvidence,
  isNarrowWorkspaceMetadataFromSignals,
  isTaskEvidenceSufficient,
  shouldProceedToFinalGatherBlock,
  syncTaskEvidenceComplete,
} from "../src/agent/core/evidence-gate";
import {
  hasHardWorkspaceSignalsInRequest,
  isWorkspaceGroundedUserRequest,
  reasoningRequiresWorkspaceGather,
  requiresFactualWorkspaceGather,
} from "../src/agent/core/workspace-grounding";
import {
  collectPlaybookAcceleratorHints,
  resolveTaskPlaybook,
} from "../src/agent/core/task-playbooks";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  const playbooks = await read("src/agent/core/task-playbooks.ts");
  const prompt = await read("src/agent/prompts/loop-system-native.md");
  const runner = await read("src/agent/core/agent-loop-tool-runner.ts");

  assert.ok(loop.includes("workspaceToSnapshotInput"), "loop injects workspace snapshot");
  assert.ok(loop.includes("collectWorkspaceStructureFacts"), "loop collects structure facts");
  assert.ok(loop.includes("workspace.inspect"), "loop preloads workspace inspect");
  assert.ok(!loop.includes("finishLoopWorkspaceBlocked"), "no workspace hard stop");
  assert.ok(loop.includes("normalizeTaskReasoning"), "loop normalizes reasoning");
  assert.ok(!loop.includes("evaluateFinalEvidenceGate"), "loop no longer blocks final via gate");
  const groundingSrc = await read("src/agent/core/workspace-grounding.ts");
  assert.ok(
    groundingSrc.includes("requiresFactualWorkspaceGather"),
    "A164 primary gather resolver",
  );
  assert.ok(
    !groundingSrc.includes("商业计划"),
    "no domain negative wordlist in grounding",
  );
  assert.ok(runner.includes("syncTaskEvidenceComplete"), "tool runner syncs evidence complete");
  assert.ok(loop.includes("isMetaExplainRequest"), "loop detects meta explain");
  assert.ok(loop.includes("evaluateReasoningTurn"), "loop uses adaptive reasoning mode");
  assert.ok(loop.includes("buildAdaptiveReasoningSkipHint"), "loop injects skip hint");
  assert.ok(loop.includes("collectPlaybookAcceleratorHints"), "loop uses accelerator hints");
  assert.ok(!loop.includes("conversation-recall"), "no hardcoded recall playbook in loop");
  assert.ok(!loop.includes("browser-live-page"), "no hardcoded browser-live playbook in loop");
  assert.ok(!runner.includes("evaluateToolEvidenceGate"), "tool runner no longer blocks via gate");
  assert.ok(!playbooks.includes("browser-live-page"), "playbook removed browser-live-page");
  assert.ok(!playbooks.includes("conversation-recall"), "playbook removed conversation-recall");
  assert.ok(playbooks.includes("collectPlaybookAcceleratorHints"), "accelerator hints export");
  assert.ok(prompt.includes("WORKSPACE_STRUCTURE"), "prompt has structure facts block");
  assert.ok(prompt.includes("derive prerequisite"), "prompt derives prerequisites");
  assert.ok(!prompt.includes("禁止** project.index"), "no hardcoded browser title rule");

  const reasoningJson = JSON.stringify({
    understanding: "用户可能在问 workspace 站点标题或浏览器标签标题。",
    intent: "qa",
    risk: "read_only",
    evidenceNeeded: ["确认指 workspace 还是 embedded browser"],
    planSteps: ["若 workspace：读 layout/metadata；若 browser：browser.inspect"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "按歧义选择取证方式",
  });
  const parsed = parseTaskReasoning(reasoningJson);
  assert.ok(parsed?.intent === "qa");
  assert.equal(parsed?.canAnswerNow, false);

  const recallHint = buildPostReasoningHint(
    {
      ...parsed!,
      canAnswerNow: true,
      evidenceNeeded: [],
      intent: "meta",
      risk: "read_only",
    },
    false,
  );
  assert.ok(recallHint?.includes("直接中文 final"));

  assert.ok(isMetaExplainRequest("把你的思考过程给我"));
  assert.ok(!isMetaExplainRequest("网站标题是什么"));

  const memoryOnly = normalizeTaskReasoning(
    {
      ...parsed!,
      canAnswerNow: true,
      evidenceNeeded: [],
    },
    {
      userRequest: "网站标题是什么",
      metaExplain: false,
      hasThreadMemory: true,
      filesReadCount: 0,
      toolsCalledCount: 0,
    },
  );
  assert.equal(memoryOnly.canAnswerNow, false);
  assert.ok(
    memoryOnly.evidenceNeeded.some((item) => item.includes("thread memory")),
  );

  const reasoningPrompt = buildReasoningTurnUserMessage({
    userRequest: "这个网站的标题是什么",
    playbookHints: [],
    uiContext: {
      layout: "triple",
      activeRoute: "/",
      browserActiveTab: { url: "https://www.baidu.com/", title: "百度" },
    },
    hasThreadMemory: false,
    metaExplain: false,
  });
  assert.ok(reasoningPrompt.includes("Disambiguate"));
  assert.ok(reasoningPrompt.includes("Embedded browser tab"));
  assert.ok(!reasoningPrompt.includes("禁止 project.index"));

  const siteTitlePb = resolveTaskPlaybook("这个网站的标题是什么");
  assert.equal(siteTitlePb.id, "default", "ambiguous site title stays default playbook");

  const hints = collectPlaybookAcceleratorHints(
    "只读分析 src/app/page.tsx，不要改代码",
  );
  assert.ok(hints.some((h) => h.includes("只读")));

  assert.ok(
    shouldRunReasoningTurn({
      userRequest: "hello",
      hasReferenceImages: false,
      hasPreloadedAttachments: false,
      hasPostExecuteFeedback: false,
      isFixContinuation: false,
    }),
  );

  assert.equal(
    evaluateReasoningTurn({
      userRequest: "网站项目的标题是什么",
      likelyEditRequest: false,
      metaExplain: false,
      hasReferenceImages: false,
      hasPreloadedAttachments: false,
      hasPostExecuteFeedback: false,
      isFixContinuation: false,
      hasThreadMemory: false,
    }),
    "full",
    "ambiguous first-turn QA keeps full reasoning",
  );

  assert.equal(
    evaluateReasoningTurn({
      userRequest: "只读分析 src/app/page.tsx，不要改代码",
      likelyEditRequest: false,
      metaExplain: false,
      hasReferenceImages: false,
      hasPreloadedAttachments: false,
      hasPostExecuteFeedback: false,
      isFixContinuation: false,
      hasThreadMemory: false,
    }),
    "skip",
    "explicit read-only skips reasoning",
  );

  assert.equal(
    evaluateReasoningTurn({
      userRequest: "继续",
      likelyEditRequest: false,
      metaExplain: false,
      hasReferenceImages: false,
      hasPreloadedAttachments: false,
      hasPostExecuteFeedback: false,
      isFixContinuation: false,
      hasThreadMemory: true,
    }),
    "skip",
    "thread follow-up skips reasoning",
  );

  assert.equal(
    evaluateReasoningTurn({
      userRequest: "把你的思考过程给我",
      likelyEditRequest: false,
      metaExplain: true,
      hasReferenceImages: false,
      hasPreloadedAttachments: false,
      hasPostExecuteFeedback: false,
      isFixContinuation: false,
      hasThreadMemory: true,
    }),
    "full",
    "meta explain keeps full reasoning",
  );

  assert.ok(looksComplexTask("先 npm run build 然后 lint"));
  assert.ok(!looksComplexTask("package.json 里的 name 是什么"));

  const { formatModelErrorMessage } = await import("../src/lib/model-error-message");
  const html524 = `<!DOCTYPE html><html><head><title>queqiao.online | 524: A timeout occurred</title></head><body><h1>A timeout occurred</h1></body></html>`;
  const sanitized = formatModelErrorMessage(`OpenAI 兼容中转 API error: ${html524}`);
  assert.ok(sanitized.includes("524"));
  assert.ok(!sanitized.includes("<!DOCTYPE"));
  assert.ok(sanitized.length < 200);

  const skipHint = buildAdaptiveReasoningSkipHint({
    userRequest: "只读看看 README",
    playbookHints: ["hint-a"],
    hasThreadMemory: true,
    workspaceSnapshot: {
      rootPath: "/tmp/vec-next",
      framework: "next",
      packageName: "vec-next",
    },
  });
  assert.ok(skipHint.includes("[REASONING_SKIPPED"));
  assert.ok(skipHint.includes("disambiguate"));
  assert.ok(skipHint.includes("THREAD_MEMORY"));

  const state = createAgentLoopRunState("改 page.tsx");
  const gate = evaluateToolEvidenceGate(
    "file.replace.prepare",
    { path: "src/app/page.tsx" },
    state,
  );
  assert.equal(gate.allowed, false);

  state.filesRead.push("src/app/page.tsx");
  const allowed = evaluateToolEvidenceGate(
    "file.replace.prepare",
    { path: "src/app/page.tsx" },
    state,
  );
  assert.equal(allowed.allowed, true);

  const qaState = createAgentLoopRunState("网站标题是什么");
  qaState.taskReasoning = {
    understanding: "只读问答",
    intent: "qa",
    risk: "read_only",
    evidenceNeeded: [],
    planSteps: [],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "file.read",
    source: "model",
  };
  const finalBlocked = evaluateFinalEvidenceGate(qaState);
  assert.equal(finalBlocked.allowed, false);

  qaState.toolsCalled.push("file.read");
  const finalAllowed = evaluateFinalEvidenceGate(qaState);
  assert.equal(finalAllowed.allowed, true);

  qaState.metaExplainMode = true;
  const metaAllowed = evaluateFinalEvidenceGate(qaState);
  assert.equal(metaAllowed.allowed, true);

  const advisoryRequest =
    "帮我设计一个水产品团购产品方案和商业计划，面向四五线城市微信社群";
  assert.equal(hasHardWorkspaceSignalsInRequest(advisoryRequest), false);
  assert.equal(isWorkspaceGroundedUserRequest(advisoryRequest), false);
  const advisoryState = createAgentLoopRunState(advisoryRequest);
  advisoryState.taskReasoning = {
    understanding: "用户要商业与产品规划，不依赖仓库代码事实",
    intent: "analysis",
    risk: "read_only",
    grounding: "none",
    evidenceNeeded: [],
    planSteps: ["输出 PRD 大纲", "列出 MVP 功能", "给出运营节奏"],
    ambiguity: null,
    canAnswerNow: true,
    plannedNext: "直接中文 final 输出方案",
    source: "model",
  };
  assert.equal(
    reasoningRequiresWorkspaceGather(advisoryState.taskReasoning!),
    false,
  );
  assert.equal(requiresFactualWorkspaceGather(advisoryState.taskReasoning!), false);
  const advisoryFinal = evaluateFinalEvidenceGate(advisoryState);
  assert.equal(
    advisoryFinal.allowed,
    true,
    "advisory tasks must not require file.read gather",
  );

  const legalAdvisory =
    "请帮我起草一份劳动合同解除协议的风险要点，不涉及代码仓库";
  const legalState = createAgentLoopRunState(legalAdvisory);
  legalState.taskReasoning = {
    understanding: "法律咨询草稿",
    intent: "analysis",
    risk: "read_only",
    evidenceNeeded: [],
    planSteps: ["列出风险点", "给出条款建议"],
    ambiguity: null,
    canAnswerNow: true,
    plannedNext: "中文 final",
    source: "model",
  };
  assert.equal(requiresFactualWorkspaceGather(legalState.taskReasoning!), false);
  assert.equal(evaluateFinalEvidenceGate(legalState).allowed, true);

  const indexState = createAgentLoopRunState("标题");
  indexState.taskReasoning = {
    understanding: "只读问答",
    intent: "qa",
    risk: "read_only",
    evidenceNeeded: ["layout metadata"],
    planSteps: ["locate layout"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "file.read",
    source: "model",
  };
  indexState.toolsCalled.push("project.index");
  const indexGate = evaluateToolEvidenceGate("project.index", {}, indexState);
  assert.equal(indexGate.allowed, false);

  const scopedIndexGate = evaluateToolEvidenceGate(
    "project.index",
    { query: "layout" },
    indexState,
  );
  assert.equal(scopedIndexGate.allowed, true);

  const narrowReasoning = {
    understanding: "问工作区网站标题",
    intent: "qa" as const,
    risk: "read_only" as const,
    evidenceNeeded: ["layout metadata"],
    planSteps: ["read layout"],
    ambiguity: "page title vs package name",
    canAnswerNow: false,
    plannedNext: "file.read",
    source: "model" as const,
  };
  assert.ok(
    isNarrowWorkspaceMetadataFromSignals(narrowReasoning, "网站项目的标题是什么"),
  );

  const layoutState = createAgentLoopRunState("网站项目的标题是什么");
  layoutState.workspaceFramework = "Next.js";
  layoutState.taskReasoning = narrowReasoning;
  layoutState.filesRead.push("src/app/layout.tsx");
  const browserGate = evaluateToolEvidenceGate(
    "browser.inspect",
    {},
    layoutState,
  );
  assert.equal(browserGate.allowed, false);

  layoutState.filesRead.push("package.json");
  const extraReadGate = evaluateToolEvidenceGate(
    "file.read",
    { path: "README.md" },
    layoutState,
  );
  assert.equal(extraReadGate.allowed, false);
  assert.equal(extraReadGate.proceedToFinal, true);
  assert.ok(hasLayoutMetadataEvidence(layoutState));
  assert.ok(hasPackageNameEvidence(layoutState));

  const indexOnlyState = createAgentLoopRunState("网站标题");
  indexOnlyState.workspaceFramework = "Next.js";
  indexOnlyState.taskReasoning = narrowReasoning;
  indexOnlyState.filesRead.push("index.html", "package.json");
  const layoutReadAllowed = evaluateToolEvidenceGate(
    "file.read",
    { path: "src/app/layout.tsx" },
    indexOnlyState,
  );
  assert.equal(layoutReadAllowed.allowed, true, "index+package must not block layout read");

  indexOnlyState.filesRead.push("src/app/layout.tsx");
  const afterLayoutGate = evaluateToolEvidenceGate(
    "file.read",
    { path: "README.md" },
    indexOnlyState,
  );
  assert.equal(afterLayoutGate.allowed, false);
  assert.equal(afterLayoutGate.proceedToFinal, true);

  const locateState = createAgentLoopRunState("网站标题");
  locateState.taskReasoning = narrowReasoning;
  locateState.toolsCalled.push("file.locate");
  const listGate = evaluateToolEvidenceGate("file.list", { path: "src/app" }, locateState);
  assert.equal(listGate.allowed, false);

  const genericState = createAgentLoopRunState("项目有哪些 API 路由");
  genericState.taskReasoning = {
    understanding: "只读列举",
    intent: "qa",
    risk: "read_only",
    evidenceNeeded: [],
    planSteps: ["file.read routes"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "final",
    source: "model",
  };
  genericState.toolsCalled.push("file.read");
  assert.ok(isTaskEvidenceSufficient(genericState));
  syncTaskEvidenceComplete(genericState);
  assert.equal(genericState.taskEvidenceComplete, true);
  const genericGatherBlock = evaluateToolEvidenceGate(
    "file.search",
    { query: "api" },
    genericState,
  );
  assert.equal(genericGatherBlock.allowed, false);
  assert.equal(genericGatherBlock.proceedToFinal, true);
  assert.ok(shouldProceedToFinalGatherBlock(genericState));

  const stillNeeding = createAgentLoopRunState("某配置值");
  stillNeeding.taskReasoning = {
    ...genericState.taskReasoning!,
    evidenceNeeded: ["still need package.json"],
  };
  stillNeeding.toolsCalled.push("file.locate");
  assert.equal(isTaskEvidenceSufficient(stillNeeding), false);

  console.log("validate-loop-reasoning: passed");
}

main().catch((error) => {
  console.error("validate-loop-reasoning failed:", error);
  process.exit(1);
});

import assert from "node:assert/strict";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import { isEditTaskSatisfied } from "../src/agent/core/agent-loop-state";
import {
  hasPageUiDeliverable,
  inferDeliverableProfile,
  isBareIndexHtmlOnly,
  isEditDeliverableSatisfied,
  isPageEntryPath,
  isScaffoldOnlyPath,
  recordFilesWritten,
} from "../src/agent/core/loop-deliverable";
import { computePlaybookProgress, getPlaybookById, resolveTaskPlaybook } from "../src/agent/core/task-playbooks";
import {
  createAgentLoopPlan,
  specializeAgentLoopPlan,
  syncAgentLoopPlanProgress,
} from "../src/agent/core/agent-loop-plan";

assert.equal(isPageEntryPath("index.html"), true);
assert.equal(isPageEntryPath("src/app/page.tsx"), true);
assert.equal(isScaffoldOnlyPath("package.json"), true);

const replicateReq = "我想复刻这个首页写到当前项目 http://example.com/";
const profile = inferDeliverableProfile({
  userRequest: replicateReq,
  playbookId: "design-replicate",
});
assert.equal(profile.kind, "page_ui");

const state = createAgentLoopRunState(replicateReq);
state.playbookId = "design-replicate";
state.likelyEditRequest = true;
state.editApplied = true;
recordFilesWritten(state, ["package.json"]);
assert.equal(isEditDeliverableSatisfied(state, "design-replicate"), false);
assert.equal(isEditTaskSatisfied(state), false);

recordFilesWritten(state, ["index.html"]);
assert.equal(isBareIndexHtmlOnly(["index.html"]), true);
assert.equal(hasPageUiDeliverable(state), false);
assert.equal(isEditDeliverableSatisfied(state, "design-replicate"), false);
assert.equal(isEditTaskSatisfied(state), false);

recordFilesWritten(state, ["src/main.js", "src/styles.css"]);
assert.equal(hasPageUiDeliverable(state), true);
assert.equal(isEditDeliverableSatisfied(state, "design-replicate"), true);
assert.equal(isEditTaskSatisfied(state), true);

const stateTsx = createAgentLoopRunState(replicateReq);
stateTsx.playbookId = "design-replicate";
stateTsx.likelyEditRequest = true;
stateTsx.editApplied = true;
recordFilesWritten(stateTsx, ["src/app/page.tsx"]);
assert.equal(hasPageUiDeliverable(stateTsx), true, "single tsx page entry ok");

const pb = getPlaybookById("design-replicate");
assert.equal(pb.id, "design-replicate");
const progressScaffold = computePlaybookProgress(
  pb,
  ["browser.open", "devtools.extract_design_spec", "file.mutation"],
  ["package.json"],
);
assert.ok(!progressScaffold.completedStepIds.includes("write"), "write not done with only package.json");

const progressPage = computePlaybookProgress(
  pb,
  ["browser.open", "devtools.extract_design_spec", "file.mutation"],
  ["index.html"],
);
assert.ok(
  !progressPage.completedStepIds.includes("write"),
  "write not done with bare index.html only",
);

const progressComplete = computePlaybookProgress(
  pb,
  ["browser.open", "devtools.extract_design_spec", "file.mutation"],
  ["index.html", "src/main.js", "src/styles.css"],
);
assert.ok(
  progressComplete.completedStepIds.includes("write"),
  "write done with index + main + css",
);

const plan = createAgentLoopPlan(replicateReq);
const planEarly = syncAgentLoopPlanProgress(plan, {
  ...state,
  editApplied: false,
  filesWritten: [],
  toolsCalled: ["workspace.inspect", "file.read"],
  filesRead: [".agent-state/tool-results/foo.json"],
  taskReasoning: undefined,
  reasoningCompleted: false,
});
assert.equal(
  planEarly.steps.length,
  0,
  "Codex-style checklist should not emit a fixed template before reasoning",
);

const dynamicPlan = specializeAgentLoopPlan(plan, {
  reasoning: {
    understanding: "复刻首页",
    intent: "code_edit",
    risk: "write",
    evidenceNeeded: [],
    planSteps: ["确认复刻首页目标", "提取设计规格", "写入首页文件"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "write page",
    source: "model",
  },
});
const planUnderstood = syncAgentLoopPlanProgress(dynamicPlan, {
  ...state,
  editApplied: false,
  taskReasoning: {
    understanding: "复刻首页",
    intent: "code_edit",
    risk: "write",
    evidenceNeeded: [],
    planSteps: ["extract", "write"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "write page",
    source: "model",
  },
  toolsCalled: ["devtools.extract_design_spec"],
  filesRead: [],
});
assert.equal(
  planUnderstood.steps[0]?.status,
  "completed",
);
assert.ok(
  planUnderstood.steps.some((step) => step.status === "in_progress"),
  "dynamic checklist should keep one active step",
);

console.log("validate-loop-deliverable: passed");

import assert from "node:assert/strict";
import {
  createAgentLoopPlan,
  specializeAgentLoopPlan,
  syncAgentLoopPlanProgress,
} from "../src/agent/core/agent-loop-plan";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import type { TaskReasoning } from "../src/agent/core/loop-reasoning";
import { getPlaybookById } from "../src/agent/core/task-playbooks";

const request = "这个项目帮我复刻一下百度网站进来 只需要首页";
const reasoning: TaskReasoning = {
  understanding:
    "用户希望在当前 workspace 中实现一个百度首页的静态复刻页面，只需要首页。",
  intent: "code_edit",
  risk: "write",
  evidenceNeeded: ["当前工作区入口文件", "百度首页布局和交互"],
  planSteps: [
    "将“百度网站”理解为要在当前 workspace 中复刻百度首页，而不是修改浏览器标签页或项目标题",
    "打开百度首页并提取/观察首页布局、主要元素、颜色、间距和交互细节",
    "写入 index.html、styles.css、script.js 等静态首页文件",
    "本地打开生成的 index.html 做一次可视化验证，如有明显问题再修正",
  ],
  ambiguity: null,
  canAnswerNow: false,
  plannedNext: "观察百度首页并写入静态页面文件",
  source: "model",
};

const empty = createAgentLoopPlan(request);
assert.equal(empty.steps.length, 0, "Codex-style plan should be omitted until available");

const specialized = specializeAgentLoopPlan(empty, {
  reasoning,
  playbook: getPlaybookById("code-edit-general"),
});

assert.equal(specialized.steps.length, reasoning.planSteps.length);
assert.equal(specialized.steps[0]?.status, "in_progress");
assert.ok(
  specialized.steps.slice(1).every((step) => step.status === "pending"),
  "initial dynamic plan should use Codex statuses",
);
assert.ok(
  specialized.steps.every((step) => step.step && !step.id),
  "new plans should be driven by step text rather than fixed ids",
);
assert.ok(
  specialized.steps.some((step) => step.step.includes("百度")),
  "specific plan should preserve task target",
);
assert.ok(
  specialized.steps.some((step) => step.step.includes("index.html")),
  "specific plan should include concrete files/actions",
);
assert.ok(
  !specialized.steps.some((step) => step.step === "理解需求与约束"),
  "specific plan must not fall back to the old fixed template",
);

const state = createAgentLoopRunState(request);
state.taskReasoning = reasoning;
state.reasoningCompleted = true;
state.likelyEditRequest = true;
state.toolsCalled = ["workspace.inspect", "devtools.extract_design_spec"];
const progressed = syncAgentLoopPlanProgress(specialized, state, {
  lastAction: "reflect",
});
assert.ok(
  progressed.steps.every((step) =>
    ["pending", "in_progress", "completed"].includes(step.status),
  ),
  "progress sync should keep Codex status vocabulary",
);
assert.equal(
  progressed.steps.filter((step) => step.status === "in_progress").length,
  1,
  "Codex update_plan allows at most one in_progress item",
);
assert.equal(progressed.steps[0]?.status, "completed");
assert.ok(
  progressed.steps.some((step) => step.status === "in_progress" && step.step.includes("写入")),
  "after gather, write step should become active",
);

console.log("validate-specific-agent-plan: passed");

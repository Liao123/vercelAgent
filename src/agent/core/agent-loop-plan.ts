/**
 * Codex-style task checklist.
 *
 * Mirrors Codex update_plan semantics: the plan is an authoritative list of
 * dynamic `{ step, status }` items, not a fixed local workflow template.
 */
import type { AgentPlan, AgentPlanStep, AgentPlanStepStatus } from "@/agent/types";
import { nowIso } from "@/agent/types";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import { isEditTaskSatisfied } from "@/agent/core/agent-loop-state";
import { isEditDeliverableSatisfied } from "@/agent/core/loop-deliverable";
import type { TaskReasoning } from "@/agent/core/loop-reasoning";
import type { ResolvedTaskPlaybook } from "@/agent/core/task-playbooks";

const GATHER_TOOLS = new Set([
  "workspace.inspect",
  "project.index",
  "file.locate",
  "ui.trace_from_page",
  "file.list",
  "file.read",
  "file.search",
  "jsx.find_text",
  "symbol.find_references",
  "git.status",
  "git.diff",
  "browser.inspect",
  "browser.wait_and_inspect",
  "devtools.extract_design_spec",
]);

const WRITE_TOOLS = new Set(["file.replace", "file.mutation", "patch.apply"]);

type CodexPlanStatus = "pending" | "in_progress" | "completed";
type PlanMilestone = "understand" | "gather" | "write" | "verify" | "final" | "other";

export type PlanProgressHint = {
  lastAction?: "reflect" | "tool" | "final";
  taskCompleted?: boolean;
};

function normalizePlanText(input: string): string {
  return input
    .replace(/^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniquePlanTexts(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = normalizePlanText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function createPlanStep(
  step: string,
  status: CodexPlanStatus = "pending",
): AgentPlanStep {
  return { step, title: step, status };
}

function normalizeStatus(status: AgentPlanStepStatus): CodexPlanStatus {
  if (status === "completed" || status === "done" || status === "skipped") {
    return "completed";
  }
  if (status === "in_progress" || status === "doing" || status === "blocked") {
    return "in_progress";
  }
  return "pending";
}

function normalizeStep(step: AgentPlanStep): AgentPlanStep {
  const text = normalizePlanText(step.step || step.title || "");
  return {
    ...step,
    step: text,
    title: text,
    status: normalizeStatus(step.status),
  };
}

function isMeaningfulWorkspaceRead(path: string): boolean {
  const n = path.replaceAll("\\", "/");
  if (n.includes(".agent-state/tool-results/")) return false;
  if (n.startsWith(".agent-state/")) return false;
  return true;
}

function hasMeaningfulGather(state: AgentLoopRunState): boolean {
  const meaningfulReads = state.filesRead.filter(isMeaningfulWorkspaceRead);
  if (meaningfulReads.length > 0) return true;
  return state.toolsCalled.some((tool) => GATHER_TOOLS.has(tool));
}

function playbookPlanTexts(
  playbook?: Pick<ResolvedTaskPlaybook, "id" | "title" | "goldenSteps">,
): string[] {
  if (!playbook || playbook.id === "default") return [];
  const labels = uniquePlanTexts(playbook.goldenSteps.map((step) => step.label));
  if (labels.length > 0) return labels;
  return [`确认${playbook.title}目标`, "执行必要操作", "验证结果并交付"];
}

function reasoningPlanTexts(input: {
  reasoning?: TaskReasoning;
  playbook?: Pick<ResolvedTaskPlaybook, "id" | "title" | "goldenSteps">;
}): string[] {
  const fromReasoning = uniquePlanTexts(input.reasoning?.planSteps ?? []);
  if (fromReasoning.length > 0) return fromReasoning;
  return playbookPlanTexts(input.playbook);
}

function classifyStep(text: string, index: number, total: number): PlanMilestone {
  if (/总结|交付|说明|汇报|收尾|运行方式|结论|final|deliver/i.test(text)) {
    return "final";
  }
  if (/验证|测试|检查|修正|确认.*效果|运行|打开.*确认|截图|lint|typecheck|build|对照效果/i.test(text)) {
    return "verify";
  }
  if (/理解|确认.*目标|明确|判断|区分|识别|界定|需求|范围|约束|workspace/i.test(text)) {
    return "understand";
  }
  if (/写入|修改|创建|实现|生成|变更|更新|删除|替换|应用|落盘|补|改成|patch|file\.mutation|file\.replace/i.test(text)) {
    return "write";
  }
  if (/读取|定位|打开|观察|提取|获取|搜索|查看|对照|分析|审查|确认.*文件|browser|file\.read|project\.index|trace/i.test(text)) {
    return "gather";
  }
  if (index === 0) return "understand";
  if (index === total - 1) return "final";
  return "other";
}

function milestoneDone(
  milestone: PlanMilestone,
  input: {
    understood: boolean;
    gathered: boolean;
    wrote: boolean;
    verified: boolean;
    finished: boolean;
    readOnly: boolean;
  },
): boolean {
  if (input.finished) return true;
  if (milestone === "understand") return input.understood;
  if (milestone === "gather") return input.gathered;
  if (milestone === "write") return input.readOnly ? input.gathered : input.wrote;
  if (milestone === "verify") return input.verified;
  if (milestone === "final") return false;
  return false;
}

export function createAgentLoopPlan(userRequest: string): AgentPlan {
  return {
    goal: userRequest,
    steps: [],
    risks: [],
    verification: [],
    updatedAt: nowIso(),
  };
}

export function specializeAgentLoopPlan(
  plan: AgentPlan,
  input: {
    reasoning?: TaskReasoning;
    playbook?: Pick<ResolvedTaskPlaybook, "id" | "title" | "goldenSteps">;
  },
): AgentPlan {
  const texts = reasoningPlanTexts(input);
  if (texts.length === 0) return plan;
  return {
    ...plan,
    explanation: input.reasoning?.plannedNext,
    steps: texts.map((text, index) =>
      createPlanStep(text, index === 0 ? "in_progress" : "pending"),
    ),
    risks: input.reasoning?.ambiguity ? [input.reasoning.ambiguity] : [],
    verification: input.reasoning?.planSteps.filter((step) =>
      /验证|测试|检查|运行|打开/u.test(step),
    ) ?? [],
    updatedAt: nowIso(),
  };
}

/** 根据 Loop 运行态更新动态 checklist，保持 Codex 三态且最多一个 in_progress。 */
export function syncAgentLoopPlanProgress(
  plan: AgentPlan,
  state: AgentLoopRunState,
  hint: PlanProgressHint = {},
): AgentPlan {
  const steps = plan.steps
    .map(normalizeStep)
    .filter((step) => step.step.length > 0);
  if (steps.length === 0) return { ...plan, steps, updatedAt: nowIso() };

  const readOnly = !state.likelyEditRequest;
  const understood = Boolean(state.taskReasoning) || state.reasoningCompleted === true;
  const gathered = hasMeaningfulGather(state) || state.taskEvidenceComplete === true;
  const wrote =
    Boolean(state.editApplied) ||
    Boolean(state.filesWritten?.length) ||
    state.toolsCalled.some((tool) => WRITE_TOOLS.has(tool)) ||
    isEditDeliverableSatisfied(state, state.playbookId);
  const verified =
    hint.lastAction === "final" ||
    state.taskEvidenceComplete === true ||
    (state.reflectionRounds > 0 && (wrote || readOnly));
  const finished =
    hint.taskCompleted === true ||
    hint.lastAction === "final" ||
    isEditTaskSatisfied(state, state.playbookId);

  const milestoneState = {
    understood,
    gathered,
    wrote,
    verified,
    finished,
    readOnly,
  };

  const nextSteps: AgentPlanStep[] = steps.map((step, index) => {
    const milestone = classifyStep(step.step, index, steps.length);
    const done = milestoneDone(milestone, milestoneState);
    return { ...step, status: done ? "completed" : "pending" };
  });

  let activeIndex = nextSteps.findIndex((step) => step.status !== "completed");
  if (activeIndex < 0) activeIndex = nextSteps.length - 1;
  if (!finished && activeIndex >= 0) {
    nextSteps[activeIndex] = {
      ...nextSteps[activeIndex],
      status: "in_progress",
    };
    for (let index = activeIndex + 1; index < nextSteps.length; index += 1) {
      nextSteps[index] = { ...nextSteps[index], status: "pending" };
    }
  }

  return { ...plan, steps: nextSteps, updatedAt: nowIso() };
}

export function completedAgentLoopPlan(plan: AgentPlan): AgentPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...normalizeStep(step),
      status: "completed",
    })),
    updatedAt: nowIso(),
  };
}

/** Codex update_plan has no blocked state; failed tasks leave the current item in progress. */
export function failedAgentLoopPlan(plan: AgentPlan): AgentPlan {
  const steps = plan.steps.map(normalizeStep);
  const activeIndex = steps.findIndex((step) => step.status !== "completed");
  if (activeIndex >= 0) {
    steps[activeIndex] = { ...steps[activeIndex], status: "in_progress" };
  }
  return { ...plan, steps, updatedAt: nowIso() };
}

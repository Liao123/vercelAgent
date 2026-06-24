/**
 * Agent Loop 任务规划（中文步骤 + 运行态同步）。
 * Cursor 式：不按工具次数假打勾，按真实理解/交付推进。
 */
import type { AgentPlan, AgentPlanStepStatus } from "@/agent/types";
import { nowIso } from "@/agent/types";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import { isEditTaskSatisfied } from "@/agent/core/agent-loop-state";
import { isEditDeliverableSatisfied } from "@/agent/core/loop-deliverable";

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

const PREPARE_TOOLS = new Set([
  "file.replace.prepare",
  "file.mutation.prepare",
  "patch.prepare",
  "git.mutation.prepare",
  "shell.command.prepare",
  "shell.run.prepare",
]);

const WRITE_TOOLS = new Set([
  "file.replace",
  "file.mutation",
  "patch.apply",
]);

function isMeaningfulWorkspaceRead(path: string): boolean {
  const n = path.replaceAll("\\", "/");
  if (n.includes(".agent-state/tool-results/")) return false;
  if (n.startsWith(".agent-state/")) return false;
  return true;
}

function hasMeaningfulGather(state: AgentLoopRunState): boolean {
  const meaningfulReads = state.filesRead.filter(isMeaningfulWorkspaceRead);
  if (meaningfulReads.length > 0) return true;
  return state.toolsCalled.some((tool) =>
    [
      "project.index",
      "file.locate",
      "browser.inspect",
      "browser.wait_and_inspect",
      "devtools.extract_design_spec",
      "workspace.inspect",
    ].includes(tool),
  );
}

export function createAgentLoopPlan(userRequest: string): AgentPlan {
  return {
    goal: userRequest,
    steps: [
      {
        id: "understand",
        title: "理解需求与约束",
        status: "doing",
      },
      {
        id: "gather",
        title: "定位并读取相关文件",
        status: "todo",
      },
      {
        id: "prepare",
        title: "准备代码变更审批",
        status: "todo",
      },
      {
        id: "reflect",
        title: "反思进度并调整策略",
        status: "todo",
      },
      {
        id: "finish",
        title: "总结结果并交付",
        status: "todo",
      },
    ],
    risks: [
      "改代码必须先产生审批，用户在界面批准并执行后才会写盘。",
      "file.replace.prepare 的 search 必须与磁盘内容完全一致，不能凭中文描述猜测。",
    ],
    verification: [
      "改代码类任务应以交付物落盘或明确阻塞原因结束。",
    ],
    updatedAt: nowIso(),
  };
}

function setStep(
  steps: AgentPlan["steps"],
  id: string,
  status: AgentPlanStepStatus,
): void {
  const step = steps.find((item) => item.id === id);
  if (step) step.status = status;
}

export type PlanProgressHint = {
  lastAction?: "reflect" | "tool" | "final";
  taskCompleted?: boolean;
};

/** 根据 Loop 运行态更新计划步骤，供右侧「任务规划」展示。 */
export function syncAgentLoopPlanProgress(
  plan: AgentPlan,
  state: AgentLoopRunState,
  hint: PlanProgressHint = {},
): AgentPlan {
  const steps = plan.steps.map((step) => ({ ...step }));
  const readOnly = !state.likelyEditRequest;
  const triedPrepare = state.toolsCalled.some((tool) => PREPARE_TOOLS.has(tool));
  const triedWrite = state.toolsCalled.some((tool) => WRITE_TOOLS.has(tool));
  const understood =
    Boolean(state.taskReasoning) || state.reasoningCompleted === true;
  const gathered = hasMeaningfulGather(state);
  const deliverableOk = isEditDeliverableSatisfied(state, state.playbookId);

  if (hint.taskCompleted) {
    for (const step of steps) {
      if (step.status !== "skipped") step.status = "done";
    }
    return { ...plan, steps, updatedAt: nowIso() };
  }

  if (understood) {
    setStep(steps, "understand", "done");
  } else {
    setStep(steps, "understand", hint.lastAction === "tool" ? "doing" : "doing");
  }

  if (readOnly) {
    setStep(steps, "prepare", "skipped");
    if (state.taskEvidenceComplete || gathered) {
      setStep(steps, "gather", "done");
    } else if (hint.lastAction === "tool") {
      setStep(steps, "gather", "doing");
    }
  } else if (deliverableOk) {
    setStep(steps, "gather", "done");
    setStep(steps, "prepare", triedPrepare || triedWrite ? "done" : "doing");
  } else if (triedPrepare) {
    setStep(steps, "gather", gathered ? "done" : "doing");
    setStep(steps, "prepare", "doing");
  } else if (gathered) {
    setStep(steps, "gather", "done");
    setStep(steps, "prepare", triedWrite ? "doing" : "todo");
  } else if (hint.lastAction === "tool") {
    setStep(steps, "gather", "doing");
  }

  if (hint.lastAction === "reflect") {
    setStep(steps, "reflect", "doing");
  } else if (state.reflectionRounds > 0 && (deliverableOk || readOnly)) {
    setStep(steps, "reflect", "done");
  }

  if (deliverableOk || (readOnly && state.taskEvidenceComplete)) {
    setStep(steps, "finish", hint.lastAction === "final" ? "done" : "doing");
  } else if (isEditTaskSatisfied(state, state.playbookId) && readOnly) {
    setStep(steps, "finish", hint.lastAction === "final" ? "done" : "doing");
  }

  if (state.lastPrepareError || state.lastToolError) {
    const blockedStep = triedPrepare ? "prepare" : "gather";
    const target = steps.find((step) => step.id === blockedStep);
    if (target && target.status !== "done" && target.status !== "skipped") {
      target.status = "blocked";
    }
  }

  return { ...plan, steps, updatedAt: nowIso() };
}

export function completedAgentLoopPlan(plan: AgentPlan): AgentPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.status === "skipped" ? step : { ...step, status: "done" },
    ),
    updatedAt: nowIso(),
  };
}

/** 任务未交付或模型连续失败：finish 标 blocked，不全标 done。 */
export function failedAgentLoopPlan(plan: AgentPlan): AgentPlan {
  const steps = plan.steps.map((step) => ({ ...step }));
  const finish = steps.find((s) => s.id === "finish");
  if (finish && finish.status !== "skipped") {
    finish.status = "blocked";
  }
  return { ...plan, steps, updatedAt: nowIso() };
}

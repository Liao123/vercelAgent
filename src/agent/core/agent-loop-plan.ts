/**
 * Agent Loop 任务规划（中文步骤 + 运行态同步）。
 */
import type { AgentPlan, AgentPlanStepStatus } from "@/agent/types";
import { nowIso } from "@/agent/types";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";

const GATHER_TOOLS = new Set([
  "workspace.inspect",
  "project.index",
  "file.locate",
  "file.list",
  "file.read",
  "file.search",
  "git.status",
  "git.diff",
]);

const PREPARE_TOOLS = new Set([
  "file.replace.prepare",
  "file.mutation.prepare",
  "patch.prepare",
  "git.mutation.prepare",
  "shell.command.prepare",
]);

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
      "改代码类任务应以审批就绪或明确阻塞原因结束。",
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
  const hasEvidence =
    state.filesRead.length > 0 ||
    state.toolsCalled.some((tool) => GATHER_TOOLS.has(tool));
  const triedPrepare = state.toolsCalled.some((tool) => PREPARE_TOOLS.has(tool));
  const readOnly = !state.likelyEditRequest;

  if (hint.taskCompleted) {
    for (const step of steps) {
      if (step.status !== "skipped") step.status = "done";
    }
    return { ...plan, steps, updatedAt: nowIso() };
  }

  if (hasEvidence || state.reflectionRounds > 0) {
    setStep(steps, "understand", "done");
    if (readOnly) {
      setStep(steps, "prepare", "skipped");
      setStep(
        steps,
        "gather",
        hasEvidence ? "done" : hint.lastAction === "tool" ? "doing" : "todo",
      );
    } else if (state.approvalPrepared) {
      setStep(steps, "gather", "done");
      setStep(steps, "prepare", "done");
    } else if (triedPrepare || (hasEvidence && state.likelyEditRequest)) {
      setStep(steps, "gather", hasEvidence ? "done" : "doing");
      setStep(steps, "prepare", triedPrepare ? "doing" : "todo");
    } else {
      setStep(steps, "gather", hint.lastAction === "tool" ? "doing" : "todo");
    }
  } else {
    setStep(steps, "understand", "doing");
  }

  if (hint.lastAction === "reflect") {
    setStep(steps, "reflect", "doing");
  } else if (state.reflectionRounds > 0 && (state.approvalPrepared || readOnly)) {
    setStep(steps, "reflect", "done");
  } else if (state.reflectionRounds > 0) {
    setStep(steps, "reflect", "todo");
  }

  if (state.approvalPrepared || (readOnly && hasEvidence)) {
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

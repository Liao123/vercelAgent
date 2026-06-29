"use client";

import { useMemo } from "react";
import type {
  AgentEvent,
  AgentPlan,
  AgentPlanStep,
  AgentPlanStepStatus,
} from "@/agent/types";
import { DiffView } from "@/components/diff-view";
import { getLatestPlan } from "@/lib/agent-feed";
import {
  collectTurnFileChanges,
  type FileChangeEntry,
  type TurnFileChangeSummary,
} from "@/lib/approval-file-changes";

type AgentRunStatusStripProps = {
  events: AgentEvent[];
  running: boolean;
};

export type PlanProgress = {
  total: number;
  current: number;
  completed: number;
  activeStep: AgentPlanStep | null;
  blocked: boolean;
};

function stepText(step: AgentPlanStep): string {
  return step.step || step.title || "";
}

function stepKey(step: AgentPlanStep, index: number): string {
  return step.id ?? `${index}:${stepText(step)}`;
}

function isCompletedStatus(status: AgentPlanStepStatus): boolean {
  return status === "completed" || status === "done" || status === "skipped";
}

function isActiveStatus(status: AgentPlanStepStatus): boolean {
  return status === "in_progress" || status === "doing" || status === "blocked";
}

export function resolvePlanProgress(plan: AgentPlan | null): PlanProgress {
  const rawSteps = plan?.steps ?? [];
  const countedSteps = rawSteps.filter((step) => step.status !== "skipped");
  const steps = countedSteps.length > 0 ? countedSteps : rawSteps;
  const total = steps.length;

  if (total === 0) {
    return {
      total: 0,
      current: 0,
      completed: 0,
      activeStep: null,
      blocked: false,
    };
  }

  const activeIndex = steps.findIndex((step) => isActiveStatus(step.status));
  const completed = steps.filter((step) => isCompletedStatus(step.status)).length;
  const current =
    activeIndex >= 0
      ? activeIndex + 1
      : Math.min(total, Math.max(1, completed + (completed < total ? 1 : 0)));

  return {
    total,
    current,
    completed,
    activeStep: activeIndex >= 0 ? steps[activeIndex] : steps[current - 1],
    blocked: steps.some((step) => step.status === "blocked"),
  };
}

function planStatusClass(status: AgentPlanStepStatus): string {
  if (status === "in_progress" || status === "doing") {
    return "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300";
  }
  if (status === "blocked") {
    return "border-red-500 bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300";
  }
  if (status === "completed" || status === "done" || status === "skipped") {
    return "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300";
  }
  return "border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400";
}

function StatusMark({ status }: { status: AgentPlanStepStatus }) {
  const symbol =
    status === "completed" || status === "done"
      ? "✓"
      : status === "skipped"
        ? "−"
        : status === "blocked"
          ? "!"
          : "";

  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${planStatusClass(
        status,
      )}`}
    >
      {status === "in_progress" || status === "doing" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      ) : (
        symbol
      )}
    </span>
  );
}

function PlanPopover({
  plan,
  progress,
}: {
  plan: AgentPlan;
  progress: PlanProgress;
}) {
  return (
    <div className="pointer-events-auto invisible absolute bottom-full left-1/2 z-40 mb-2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 translate-y-1 rounded-xl border border-zinc-200 bg-white p-3 text-left opacity-0 shadow-xl transition group-hover/plan:visible group-hover/plan:translate-y-0 group-hover/plan:opacity-100 group-focus-within/plan:visible group-focus-within/plan:translate-y-0 group-focus-within/plan:opacity-100 dark:border-zinc-800 dark:bg-zinc-950">
      {plan.explanation && (
        <p className="mb-2 line-clamp-2 text-[12px] text-zinc-500 dark:text-zinc-400">
          {plan.explanation}
        </p>
      )}
      <div className="space-y-1.5">
        {plan.steps.map((step, index) => (
          <div
            key={stepKey(step, index)}
            className={`flex min-w-0 gap-2 rounded-lg px-2 py-1.5 ${
              step === progress.activeStep
                ? "bg-zinc-100 dark:bg-zinc-900"
                : ""
            }`}
          >
            <StatusMark status={step.status} />
            <div className="min-w-0 flex-1">
              <p className="min-w-0 text-[13px] leading-5 text-zinc-800 dark:text-zinc-200">
                {stepText(step)}
              </p>
              {step.notes && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {step.notes}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanChip({
  plan,
  progress,
  running,
}: {
  plan: AgentPlan;
  progress: PlanProgress;
  running: boolean;
}) {
  const done =
    progress.total > 0 &&
    progress.completed >= progress.total &&
    !running &&
    !progress.blocked;
  const tone = progress.blocked
    ? "text-red-700 dark:text-red-300"
    : done
      ? "text-emerald-700 dark:text-emerald-300"
    : running
      ? "text-zinc-800 dark:text-zinc-100"
      : "text-zinc-600 dark:text-zinc-300";

  return (
    <div className="group/plan relative">
      <button
        type="button"
        className={`inline-flex h-9 max-w-[18rem] items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-[13px] shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 ${tone}`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
            done
              ? "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
              : running
                ? "border-blue-500 bg-blue-500/10 text-blue-600"
                : "border-zinc-400 bg-transparent text-zinc-400"
          }`}
        >
          {done ? "✓" : running ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
        </span>
        <span className="shrink-0">
          第 {progress.current} / {progress.total} 步
        </span>
        {progress.activeStep && stepText(progress.activeStep) && (
          <span className="hidden min-w-0 truncate text-zinc-500 sm:block">
            {stepText(progress.activeStep)}
          </span>
        )}
      </button>
      <PlanPopover plan={plan} progress={progress} />
    </div>
  );
}

function formatSigned(value: number, prefix: "+" | "-"): string {
  if (value <= 0) return `${prefix}0`;
  return `${prefix}${value}`;
}

function FileStats({ file }: { file: Pick<FileChangeEntry, "additions" | "deletions"> }) {
  return (
    <span className="shrink-0 font-mono text-[12px]">
      <span className="text-emerald-600 dark:text-emerald-400">
        {formatSigned(file.additions, "+")}
      </span>
      <span className="mx-1 text-zinc-300 dark:text-zinc-700">/</span>
      <span className="text-red-600 dark:text-red-400">
        {formatSigned(file.deletions, "-")}
      </span>
    </span>
  );
}

function FileDiffPreview({ file }: { file: FileChangeEntry }) {
  if (file.patchFile) {
    return (
      <DiffView
        before={file.patchFile.oldContent}
        after={file.patchFile.newContent}
        changesOnly
        maxRows={120}
        showLayoutToggle={false}
        className="p-2"
      />
    );
  }

  if (file.singleFileDiff) {
    return (
      <DiffView
        before={file.singleFileDiff.before}
        after={file.singleFileDiff.after}
        changesOnly
        maxRows={120}
        showLayoutToggle={false}
        className="p-2"
      />
    );
  }

  if (file.directDiff) {
    return (
      <pre className="max-h-64 overflow-auto bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-200">
        {file.directDiff}
      </pre>
    );
  }

  return (
    <p className="px-3 py-2 text-[12px] text-zinc-500 dark:text-zinc-400">
      暂无可预览 diff。
    </p>
  );
}

function FileChangeRow({ file }: { file: FileChangeEntry }) {
  return (
    <div className="group/file border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
      <button
        type="button"
        className="flex h-10 w-full min-w-0 items-center gap-3 px-3 text-left transition hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-300">
          {file.path}
        </span>
        <FileStats file={file} />
      </button>
      <div className="hidden border-t border-zinc-100 bg-white group-hover/file:block group-focus-within/file:block dark:border-zinc-800 dark:bg-zinc-950">
        <FileDiffPreview file={file} />
      </div>
    </div>
  );
}

function FilesPopover({ changes }: { changes: TurnFileChangeSummary }) {
  const hiddenCount = Math.max(0, changes.files.length - 12);
  const files = changes.files.slice(0, 12);

  return (
    <div className="pointer-events-auto invisible absolute bottom-full right-0 z-40 mb-2 w-[calc(100vw-2rem)] max-w-2xl translate-y-1 overflow-hidden rounded-xl border border-zinc-200 bg-white text-left opacity-0 shadow-xl transition group-hover/files:visible group-hover/files:translate-y-0 group-hover/files:opacity-100 group-focus-within/files:visible group-focus-within/files:translate-y-0 group-focus-within/files:opacity-100 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <p className="min-w-0 flex-1 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
          已编辑 {changes.files.length} 个文件
        </p>
        <FileStats
          file={{
            additions: changes.totalAdditions,
            deletions: changes.totalDeletions,
          }}
        />
      </div>
      <div className="max-h-[28rem] overflow-auto">
        {files.map((file) => (
          <FileChangeRow key={file.fileKey} file={file} />
        ))}
        {hiddenCount > 0 && (
          <p className="border-t border-zinc-100 px-3 py-2 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            还有 {hiddenCount} 个文件，可在右侧审查区继续看。
          </p>
        )}
      </div>
    </div>
  );
}

function FilesChip({ changes }: { changes: TurnFileChangeSummary }) {
  return (
    <div className="group/files relative">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-[13px] text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
      >
        <span className="shrink-0">{changes.files.length} 个文件已更改</span>
        <FileStats
          file={{
            additions: changes.totalAdditions,
            deletions: changes.totalDeletions,
          }}
        />
      </button>
      <FilesPopover changes={changes} />
    </div>
  );
}

export function AgentRunStatusStrip({
  events,
  running,
}: AgentRunStatusStripProps) {
  const plan = useMemo(() => getLatestPlan(events), [events]);
  const progress = useMemo(() => resolvePlanProgress(plan), [plan]);
  const changes = useMemo(() => collectTurnFileChanges(events), [events]);

  if (!plan && !changes) return null;
  if (plan && progress.total === 0 && !changes) return null;

  return (
    <div className="relative z-20 border-t border-zinc-100 bg-white/95 px-3 py-2 backdrop-blur dark:border-zinc-900 dark:bg-zinc-950/95">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-2">
        {plan && progress.total > 0 && (
          <PlanChip plan={plan} progress={progress} running={running} />
        )}
        {changes && changes.files.length > 0 && <FilesChip changes={changes} />}
      </div>
    </div>
  );
}

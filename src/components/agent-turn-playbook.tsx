"use client";

type TurnPlaybookStripProps = {
  playbook: NonNullable<
    import("@/lib/agent-turn-feed").AgentTurnFeed["playbook"]
  >;
  active?: boolean;
};

export function TurnPlaybookStrip({ playbook, active = false }: TurnPlaybookStripProps) {
  const { goldenSteps, completedCount, totalSteps, progressLabel, softMaxToolRounds } =
    playbook;

  if (totalSteps === 0) {
    return (
      <div
        className="rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-700/80 dark:bg-zinc-900/40 dark:text-zinc-400"
      >
        <span className="font-medium text-zinc-600 dark:text-zinc-300">
          {playbook.title}
        </span>
        {active && (
          <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 align-middle" />
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-3 py-2 dark:border-zinc-700/80 dark:bg-zinc-900/40"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {progressLabel}
        </span>
        <span className="text-zinc-400 dark:text-zinc-500">
          {completedCount}/{totalSteps} 步
          {softMaxToolRounds > 0 && ` · 建议 ≤${softMaxToolRounds} 轮工具`}
        </span>
        {active && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        )}
      </div>
      {goldenSteps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {goldenSteps.map((label, index) => {
            const done = index < completedCount;
            const current = index === completedCount && active;
            return (
              <span
                key={`${label}-${index}`}
                className={`rounded-md px-2 py-0.5 text-[10px] ${
                  done
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : current
                      ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                      : "bg-zinc-200/60 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                }`}
              >
                {done ? "✓ " : current ? "→ " : ""}
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

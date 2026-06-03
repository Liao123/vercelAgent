"use client";

import type { VerificationResult } from "@/agent/types";

export type PostExecuteVerificationViewModel = {
  triggered: boolean;
  success: boolean;
  summary: string;
  results: VerificationResult[];
};

type PostExecuteVerificationViewProps = {
  verification: PostExecuteVerificationViewModel;
  compact?: boolean;
  onFixLint?: () => void;
};

export function PostExecuteVerificationView({
  verification,
  compact = false,
  onFixLint,
}: PostExecuteVerificationViewProps) {
  if (!verification.triggered) return null;

  const tone = verification.success
    ? "border-emerald-200/80 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
    : "border-red-200/80 bg-red-50/80 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";

  return (
    <div className={`rounded-md border p-2.5 ${tone}`}>
      <p className={`font-medium ${compact ? "text-[11px]" : "text-[12px]"}`}>
        执行后验证 · {verification.success ? "通过" : "失败"}
      </p>
      <p className={`mt-1 ${compact ? "text-[10px]" : "text-[11px]"} opacity-90`}>
        {verification.summary}
      </p>
      {!verification.success &&
        verification.results
          .filter((item) => !item.success)
          .map((item) => (
            <pre
              key={item.command}
              className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[10px] leading-relaxed dark:bg-black/25"
            >
              {item.output || item.command}
            </pre>
          ))}
      {!verification.success && onFixLint && (
        <button
          type="button"
          onClick={onFixLint}
          className="mt-2 w-full rounded-md border border-red-300 bg-white px-2 py-1.5 text-[11px] font-medium text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900"
        >
          根据验证结果再修一轮
        </button>
      )}
    </div>
  );
}

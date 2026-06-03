"use client";

import { useEffect, useRef, useState } from "react";
import {
  readAutoApplyFileChanges,
  writeAutoApplyFileChanges,
} from "@/lib/agent-file-auto-apply";
import {
  readAutoReloopOnLintFail,
  writeAutoReloopOnLintFail,
} from "@/lib/agent-lint-reloop";
import {
  readStrictPrepareLoop,
  writeStrictPrepareLoop,
} from "@/lib/agent-strict-prepare";

type AgentAgentSettingsProps = {
  disabled?: boolean;
  onPrefsChange?: () => void;
};

function SettingRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer gap-2 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </span>
        <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {description}
        </span>
      </span>
    </label>
  );
}

/** Composer 内 Agent 偏好（对齐 Cursor 设置入口，非左栏实验开关）。 */
export function AgentAgentSettings({
  disabled = false,
  onPrefsChange,
}: AgentAgentSettingsProps) {
  const [open, setOpen] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [strictPrepare, setStrictPrepare] = useState(false);
  const [autoLintReloop, setAutoLintReloop] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setAutoApply(readAutoApplyFileChanges());
    setStrictPrepare(readStrictPrepareLoop());
    setAutoLintReloop(readAutoReloopOnLintFail());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg px-2 py-1 text-[12px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        title="Agent 设置"
        aria-label="Agent 设置"
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden
        >
          <path
            d="M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
            strokeLinecap="round"
          />
          <path
            d="M3.4 10.8c.1-.9.5-1.7 1.1-2.4l-.7-.9a1 1 0 0 1 .2-1.3l1.1-1.1a1 1 0 0 1 1.3-.2l.9.7c.7-.6 1.5-1 2.4-1.1l.2-1.4a1 1 0 0 1 1-.9h1.6a1 1 0 0 1 1 .9l.2 1.4c.9.1 1.7.5 2.4 1.1l.9-.7a1 1 0 0 1 1.3.2l1.1 1.1a1 1 0 0 1 .2 1.3l-.7.9c.6.7 1 1.5 1.1 2.4l1.4.2a1 1 0 0 1 .9 1v1.6a1 1 0 0 1-.9 1l-1.4.2c-.1.9-.5 1.7-1.1 2.4l.7.9a1 1 0 0 1-.2 1.3l-1.1 1.1a1 1 0 0 1-1.3.2l-.9-.7c-.7.6-1.5 1-2.4 1.1l-.2 1.4a1 1 0 0 1-1 .9h-1.6a1 1 0 0 1-1-.9l-.2-1.4c-.9-.1-1.7-.5-2.4-1.1l-.9.7a1 1 0 0 1-1.3-.2l-1.1-1.1a1 1 0 0 1-.2-1.3l.7-.9c-.6-.7-1-1.5-1.1-2.4l-1.4-.2a1 1 0 0 1-.9-1v-1.6a1 1 0 0 1 .9-1l1.4-.2Z"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1 w-72 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="border-b border-zinc-100 px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            Agent
          </p>
          <div className="px-1 py-1">
            <SettingRow
              label="自动应用文件变更"
              description="默认开：低/中风险直接写盘，写后自动 lint（高风险仍须审查确认）"
              checked={autoApply}
              onChange={(value) => {
                writeAutoApplyFileChanges(value);
                setAutoApply(value);
                onPrefsChange?.();
              }}
            />
            <SettingRow
              label="Strict prepare"
              description="禁用 recovery 兜底，仅用于评测或强约束改码"
              checked={strictPrepare}
              onChange={(value) => {
                writeStrictPrepareLoop(value);
                setStrictPrepare(value);
                onPrefsChange?.();
              }}
            />
            <SettingRow
              label="Lint 失败自动再修"
              description="默认开：lint/typecheck/build 失败后自动再跑一轮 Agent 修复"
              checked={autoLintReloop}
              onChange={(value) => {
                writeAutoReloopOnLintFail(value);
                setAutoLintReloop(value);
                onPrefsChange?.();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

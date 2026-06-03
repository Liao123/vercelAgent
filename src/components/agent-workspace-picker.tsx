"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon } from "@/components/chevron-icon";
import { useDesktopApp } from "@/lib/use-desktop-app";

export type WorkspacePickerProject = {
  workspaceId: string;
  name: string;
};

type AgentWorkspacePickerProps = {
  currentName: string | null;
  projects: WorkspacePickerProject[];
  busy?: boolean;
  onSelect: (workspaceId: string) => void;
  onOpenFolder?: () => void | Promise<void>;
};

export function AgentWorkspacePicker({
  currentName,
  projects,
  busy = false,
  onSelect,
  onOpenFolder,
}: AgentWorkspacePickerProps) {
  const desktop = useDesktopApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const label = currentName?.trim() || "选择工作区";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.workspaceId.toLowerCase().includes(q),
    );
  }, [projects, query]);

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
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[10rem] items-center gap-0.5 rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        title="切换工作区"
      >
        <span className="truncate">{label}</span>
        <ChevronIcon
          variant="dropdown"
          expanded={open}
          className="h-4 w-4 text-zinc-400"
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目"
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] outline-none focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-950"
              autoFocus
            />
          </div>
          <ul className="max-h-48 overflow-auto py-0.5">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[11px] text-zinc-500">无匹配项目</li>
            )}
            {filtered.map((project) => (
              <li key={project.workspaceId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onSelect(project.workspaceId);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full px-3 py-1.5 text-left text-[12px] hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                    currentName === project.name
                      ? "font-medium text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <span className="truncate">{project.name}</span>
                  {currentName === project.name && (
                    <span className="ml-auto text-[10px] text-blue-600">✓</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {desktop && onOpenFolder && (
            <div className="border-t border-zinc-100 px-1 py-1 dark:border-zinc-800">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void onOpenFolder();
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                打开文件夹…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

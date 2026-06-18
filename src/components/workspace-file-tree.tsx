"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitStatusFileEntry } from "@/lib/git-status";
import { ChevronIcon } from "@/components/chevron-icon";
import {
  buildGitStatusPathMap,
  gitTreeBadgeClass,
  gitTreeBadgeText,
  gitTreeNameClass,
  normalizeRepoPath,
} from "@/lib/git-tree-decoration";
import {
  ancestorDirsForFile,
  normalizeTreePath,
  treePathsEqual,
} from "@/lib/workspace-tree-paths";

type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

type WorkspaceFileTreeProps = {
  enabled: boolean;
  onSelectPath: (path: string) => void;
  /** 审查区选中的文件：展开目录并滚动高亮 */
  highlightPath?: string | null;
  variant?: "panel" | "compact";
};

export function WorkspaceFileTree({
  enabled,
  onSelectPath,
  highlightPath = null,
  variant = "compact",
}: WorkspaceFileTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["."]));
  const [childrenByDir, setChildrenByDir] = useState<
    Record<string, TreeEntry[]>
  >({});
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [rootError, setRootError] = useState<string | null>(null);
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({});
  const [gitByPath, setGitByPath] = useState<
    Map<string, GitStatusFileEntry>
  >(() => new Map());

  const refreshGitStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/workspace");
      const data = await res.json();
      if (!res.ok) return;
      const files = (data.workspace?.git?.files ?? []) as GitStatusFileEntry[];
      setGitByPath(buildGitStatusPathMap(files));
    } catch {
      /* 非 Git 仓库或网络失败时静默 */
    }
  }, []);

  const loadDir = useCallback(async (dirPath: string) => {
    if (dirPath === ".") setRootError(null);
    setDirErrors((prev) => {
      if (!prev[dirPath]) return prev;
      const next = { ...prev };
      delete next[dirPath];
      return next;
    });
    let skip = false;
    setChildrenByDir((prev) => {
      if (prev[dirPath]) skip = true;
      return prev;
    });
    if (skip) return;

    setLoadingDirs((prev) => {
      if (prev.has(dirPath)) {
        skip = true;
        return prev;
      }
      return new Set(prev).add(dirPath);
    });
    if (skip) return;

    try {
      const query = dirPath === "." ? "" : `?path=${encodeURIComponent(dirPath)}`;
      const res = await fetch(`/api/agent/workspace/tree${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "tree failed");
      setChildrenByDir((prev) => ({
        ...prev,
        [dirPath]: (data.entries ?? []) as TreeEntry[],
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载目录失败";
      if (dirPath === ".") {
        setRootError(message);
      } else {
        setDirErrors((prev) => ({ ...prev, [dirPath]: message }));
      }
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setChildrenByDir({});
    setExpanded(new Set(["."]));
    void loadDir(".");
    void refreshGitStatus();
  }, [enabled, loadDir, refreshGitStatus]);

  useEffect(() => {
    if (!enabled || variant !== "panel") return;
    const id = window.setInterval(() => void refreshGitStatus(), 8000);
    return () => window.clearInterval(id);
  }, [enabled, variant, refreshGitStatus]);

  useEffect(() => {
    if (!enabled || !highlightPath) return;
    const dirs = ancestorDirsForFile(highlightPath);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      return next;
    });
    for (const dir of dirs) void loadDir(dir);
  }, [enabled, highlightPath, loadDir]);

  useEffect(() => {
    if (!highlightPath || !scrollRef.current) return;
    const normalized = normalizeTreePath(highlightPath);
    const scroll = () => {
      const row = scrollRef.current?.querySelector(
        `[data-tree-path="${CSS.escape(normalized)}"]`,
      );
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const id = window.requestAnimationFrame(scroll);
    return () => window.cancelAnimationFrame(id);
  }, [highlightPath, childrenByDir, loadingDirs]);

  const toggleDir = (dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        void loadDir(dirPath);
      }
      return next;
    });
  };

  const highlighted = highlightPath
    ? normalizeTreePath(highlightPath)
    : null;

  const renderDir = (dirPath: string, depth: number) => {
    const entries = childrenByDir[dirPath];
    if (!entries) {
      const dirError = dirErrors[dirPath];
      if (dirError) {
        return (
          <p className="py-0.5 pl-2 text-[10px] text-zinc-500 dark:text-zinc-400">
            目录尚未创建或不可访问
          </p>
        );
      }
      return (
        <p className="py-0.5 pl-2 text-[10px] text-zinc-400">
          {loadingDirs.has(dirPath) ? "加载中…" : ""}
        </p>
      );
    }

    return (
      <ul className="list-none">
        {entries.map((entry) => {
          const isDir = entry.type === "directory";
          const isOpen = expanded.has(entry.path);
          const gitEntry = !isDir
            ? gitByPath.get(normalizeRepoPath(entry.path))
            : undefined;
          const isHighlighted =
            !isDir &&
            highlighted !== null &&
            treePathsEqual(entry.path, highlighted);

          return (
            <li key={entry.path}>
              <button
                type="button"
                data-tree-path={
                  isDir ? undefined : normalizeTreePath(entry.path)
                }
                className={`flex w-full min-w-0 items-center gap-1 rounded-sm px-1 py-[3px] text-left font-mono text-[11px] ${
                  isHighlighted
                    ? "bg-sky-100/90 ring-1 ring-sky-300/80 dark:bg-sky-950/50 dark:ring-sky-700"
                    : "hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80"
                }`}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                onClick={() => {
                  if (isDir) {
                    toggleDir(entry.path);
                  } else {
                    onSelectPath(entry.path);
                  }
                }}
                title={entry.path}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isDir ? <ChevronIcon expanded={isOpen} /> : null}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    gitEntry
                      ? gitTreeNameClass(gitEntry.status)
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {entry.name}
                </span>
                {gitEntry && (
                  <span className={gitTreeBadgeClass(gitEntry.status)}>
                    {gitTreeBadgeText(gitEntry.status)}
                  </span>
                )}
              </button>
              {isDir && isOpen ? renderDir(entry.path, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  if (!enabled) return null;

  const isPanel = variant === "panel";
  const shellClass = isPanel
    ? "flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950"
    : "max-h-40 overflow-auto rounded-md border border-zinc-200 bg-zinc-50/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/50";

  return (
    <div className={shellClass}>
      {!isPanel && (
        <p className="shrink-0 border-b border-zinc-100 px-2 py-1.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          工作区文件 · 点击附加 @路径
        </p>
      )}
      <div
        ref={scrollRef}
        className={`min-h-0 flex-1 overflow-auto ${isPanel ? "py-1" : "p-1"}`}
      >
        {rootError ? (
          <p className="px-2 text-[10px] text-red-600 dark:text-red-400">
            {rootError}
          </p>
        ) : (
          renderDir(".", 0)
        )}
      </div>
    </div>
  );
}

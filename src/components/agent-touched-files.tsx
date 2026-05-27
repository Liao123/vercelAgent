"use client";

import type { TouchedFileEntry } from "@/lib/agent-feed";

export function AgentTouchedFiles({ files }: { files: TouchedFileEntry[] }) {
  if (files.length === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        涉及文件
      </p>
      <ul className="mt-1 space-y-0.5">
        {files.slice(0, 12).map((file) => (
          <li
            key={file.path}
            className="flex items-baseline gap-2 font-mono text-[11px] text-zinc-700 dark:text-zinc-300"
          >
            <span className="min-w-0 flex-1 truncate" title={file.path}>
              {file.path}
            </span>
            {file.label && (
              <span className="shrink-0 text-[10px] text-zinc-500">
                {file.label}
              </span>
            )}
          </li>
        ))}
        {files.length > 12 && (
          <li className="text-[10px] text-zinc-500">+{files.length - 12} 更多</li>
        )}
      </ul>
    </div>
  );
}

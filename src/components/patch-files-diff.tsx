"use client";

import { useMemo, useState } from "react";
import { DiffView } from "@/components/diff-view";
import type { ApprovalPatchFilePreview } from "@/agent/types";

function patchFileKey(file: ApprovalPatchFilePreview): string {
  return `${file.kind ?? "modify"}:${file.oldPath ?? ""}:${file.newPath ?? file.filePath}`;
}

function patchFileTabLabel(file: ApprovalPatchFilePreview): string {
  const path =
    file.kind === "rename"
      ? `${file.oldPath ?? "?"} → ${file.newPath ?? file.filePath}`
      : file.newPath ?? file.oldPath ?? file.filePath;
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function patchFileTitle(file: ApprovalPatchFilePreview): string {
  if (file.kind === "delete") {
    return `删除 ${file.oldPath ?? file.filePath}`;
  }
  if (file.kind === "create") {
    return `新建 ${file.newPath ?? file.filePath}`;
  }
  if (file.kind === "rename") {
    return `${file.oldPath ?? "?"} → ${file.newPath ?? file.filePath}`;
  }
  return file.filePath;
}

const KIND_LABELS: Record<NonNullable<ApprovalPatchFilePreview["kind"]>, string> =
  {
    modify: "修改",
    create: "新建",
    delete: "删除",
    rename: "重命名",
  };

type PatchFilesDiffViewProps = {
  files: ApprovalPatchFilePreview[];
  /** 无变化文件是否出现在 Tab 列表中 */
  includeUnchanged?: boolean;
};

export function PatchFilesDiffView({
  files,
  includeUnchanged = false,
}: PatchFilesDiffViewProps) {
  const listed = useMemo(() => {
    const changed = files.filter((file) => file.changed);
    if (changed.length > 0) return changed;
    return includeUnchanged ? files : [];
  }, [files, includeUnchanged]);

  const [activeKey, setActiveKey] = useState(() =>
    listed[0] ? patchFileKey(listed[0]) : "",
  );

  const validActiveKey = useMemo(() => {
    if (listed.some((file) => patchFileKey(file) === activeKey)) {
      return activeKey;
    }
    return listed[0] ? patchFileKey(listed[0]) : "";
  }, [activeKey, listed]);

  const activeFile = useMemo(
    () => listed.find((file) => patchFileKey(file) === validActiveKey),
    [listed, validActiveKey],
  );

  if (listed.length === 0) {
    return (
      <p className="text-[11px] text-zinc-500">（Patch 未产生可展示的文件差异）</p>
    );
  }

  if (listed.length === 1 && activeFile) {
    return (
      <div className="space-y-1">
        <p className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
          {patchFileTitle(activeFile)}
        </p>
        <DiffView
          before={activeFile.oldContent}
          after={activeFile.newContent}
          changesOnly
          layout="split"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 dark:border-zinc-700"
        role="tablist"
        aria-label="Patch 文件"
      >
        {listed.map((file) => {
          const key = patchFileKey(file);
          const selected = key === validActiveKey;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              title={patchFileTitle(file)}
              onClick={() => setActiveKey(key)}
              className={`max-w-[200px] truncate rounded-md px-2 py-1 text-[10px] font-medium transition ${
                selected
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "bg-zinc-200/80 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {patchFileTabLabel(file)}
              {file.kind && file.kind !== "modify" && (
                <span className="ml-1 opacity-80">{KIND_LABELS[file.kind]}</span>
              )}
            </button>
          );
        })}
      </div>

      {activeFile && (
        <div role="tabpanel" className="space-y-1">
          <p className="break-all font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
            {patchFileTitle(activeFile)}
          </p>
          {activeFile.changed ? (
            <DiffView
              before={activeFile.oldContent}
              after={activeFile.newContent}
              changesOnly
              layout="split"
            />
          ) : (
            <p className="text-[11px] text-zinc-500">（此文件无行级变化）</p>
          )}
        </div>
      )}
    </div>
  );
}

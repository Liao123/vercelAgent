import type { ApprovalPatchPreview } from "@/agent/types";

type PatchFileLike = {
  kind?: "modify" | "create" | "delete" | "rename";
  oldPath?: string;
  newPath?: string;
  filePath?: string;
  changed?: boolean;
};

function fileDisplayPath(file: PatchFileLike): string {
  if (file.kind === "rename") {
    return `${file.oldPath ?? "?"} → ${file.newPath ?? file.filePath ?? "?"}`;
  }
  return file.newPath ?? file.oldPath ?? file.filePath ?? "?";
}

/** 活动流 / 审批卡片用的多文件 patch 一行摘要。 */
export function formatPatchFilesSummary(
  files: PatchFileLike[],
  options?: { maxNames?: number },
): string {
  const maxNames = options?.maxNames ?? 4;
  if (files.length === 0) return "0 个文件";

  const changed = files.filter((file) => file.changed !== false);
  const listed = (changed.length > 0 ? changed : files).slice(0, maxNames);
  const names = listed.map(fileDisplayPath).join(" · ");
  const suffix =
    files.length > maxNames ? ` 等 ${files.length} 个文件` : "";

  const changedCount = files.filter((file) => file.changed).length;
  return `${changedCount || files.length} / ${files.length} 有变化：${names}${suffix}`;
}

export function formatPatchPreviewSummary(preview: ApprovalPatchPreview): string {
  return formatPatchFilesSummary(preview.files);
}

/** 从 patch.prepare / develop 工具返回的 PatchResult 生成摘要。 */
export function formatPatchToolResultSummary(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;

  if (record.approval && typeof record.approval === "object") {
    const approval = record.approval as { title?: string };
    if (approval.title) return `已创建审批：${approval.title}`;
    return "已创建 Patch 审批";
  }

  if (!Array.isArray(record.files)) return null;
  const files = record.files as PatchFileLike[];
  const mode = record.mode === "apply" ? "已应用" : "预览";
  return `${mode} · ${formatPatchFilesSummary(files)}`;
}

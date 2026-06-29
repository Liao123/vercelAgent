/** 压缩方式等 UI 文案（中文）。 */

export function formatCompactionLayers(
  layers?: string[] | null,
): string | null {
  if (!layers?.length) return null;
  return layers.join(", ");
}

export function formatCompactMethod(method?: string | null): string {
  if (method === "semantic") return "语义压缩";
  if (method === "deterministic") return "确定性压缩";
  if (method === "none") return "未压缩";
  return method ?? "压缩";
}

export type CompactionDisplayInput = {
  method?: string | null;
  round?: number | null;
  contextWindow?: {
    windowNumber: number;
    windowId?: string;
    previousWindowId?: string;
  } | null;
  pinnedApprovalCount?: number | null;
  changedFileCount?: number | null;
  estimatedTokensBefore?: number | null;
  estimatedTokensAfter?: number | null;
  layersApplied?: string[] | null;
  summaryPreview?: string | null;
  memoryContent?: string | null;
};

export function formatCompactionMeta(input: CompactionDisplayInput): string {
  const parts: string[] = [];
  if (input.method) parts.push(formatCompactMethod(input.method));
  if (input.round != null) parts.push(`第 ${input.round} 轮`);
  if (input.contextWindow?.windowNumber != null) {
    parts.push(`window ${input.contextWindow.windowNumber}`);
  }
  const layers = formatCompactionLayers(input.layersApplied);
  if (layers) parts.push(`layers ${layers}`);
  if (input.pinnedApprovalCount != null && input.pinnedApprovalCount > 0) {
    parts.push(`${input.pinnedApprovalCount} 个审批 ID`);
  }
  if (input.changedFileCount != null && input.changedFileCount > 0) {
    parts.push(`${input.changedFileCount} 个文件`);
  }
  if (
    input.estimatedTokensBefore != null &&
    input.estimatedTokensAfter != null
  ) {
    parts.push(
      `约 ${input.estimatedTokensBefore} → ${input.estimatedTokensAfter} tokens`,
    );
  }
  return parts.join(" · ");
}

export function formatCompactionCheckpoint(input: CompactionDisplayInput): {
  title: string;
  label: string;
  summary: string;
  meta: string;
  detail?: string;
  status: string;
} {
  const windowLabel =
    input.contextWindow?.windowNumber != null
      ? `window ${input.contextWindow.windowNumber}`
      : input.round != null
        ? `第 ${input.round} 轮`
        : null;
  const title = "上下文已接续";
  const meta = formatCompactionMeta(input);
  const summary =
    input.summaryPreview?.trim() ||
    "已保存检查点，后续轮次会从任务记忆继续。";
  const detailParts = [
    "CONTEXT CHECKPOINT HANDOFF",
    meta,
    input.memoryContent?.trim() || input.summaryPreview?.trim(),
  ].filter(Boolean);

  return {
    title,
    label: windowLabel ? `${title} · ${windowLabel}` : title,
    summary,
    meta,
    detail: detailParts.length > 0 ? detailParts.join("\n\n") : undefined,
    status: meta
      ? `${title}（${meta}）`
      : windowLabel
        ? `${title}（${windowLabel}）`
        : title,
  };
}

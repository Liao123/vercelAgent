/** 压缩方式等 UI 文案（中文）。 */

export function formatCompactionLayers(layers?: string[] | null): string | null {
  if (!layers?.length) return null;
  return layers.join(", ");
}

export function formatCompactMethod(method?: string | null): string {
  if (method === "semantic") return "语义压缩";
  if (method === "deterministic") return "确定性压缩";
  if (method === "none") return "未压缩";
  return method ?? "压缩";
}

export function formatCompactionMeta(input: {
  method?: string | null;
  round?: number | null;
  pinnedApprovalCount?: number | null;
  changedFileCount?: number | null;
  estimatedTokensBefore?: number | null;
  estimatedTokensAfter?: number | null;
  layersApplied?: string[] | null;
}): string {
  const parts: string[] = [];
  if (input.method) parts.push(formatCompactMethod(input.method));
  if (input.round != null) parts.push(`第 ${input.round} 轮`);
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

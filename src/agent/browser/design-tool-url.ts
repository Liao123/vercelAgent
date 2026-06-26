/** 在线设计工具 URL / 导出意图探测（js.design、Figma 等）。 */

const DESIGN_TOOL_HOST_RE =
  /js\.design|figma\.com|mastergo\.com|lanhuapp\.com|modao\.cc|pixso\.cn/i;

export function isDesignToolUrl(input: string): boolean {
  return DESIGN_TOOL_HOST_RE.test(input.trim());
}

/** 从设计稿站导出画板 / 截图（非整站复刻）。 */
export function isDesignExportRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (isDesignReplicateLike(text)) return false;

  const hasDesignContext =
    isDesignToolUrl(text) ||
    /即时设计|js\.design|figma|mastergo|蓝湖|modao|pixso|设计稿网站|设计稿站/i.test(
      text,
    );
  const exportIntent =
    /导出|截图|截屏|第一张|画板|artboard|设计图|export|发给我|保存.*图/i.test(
      text,
    );

  if (hasDesignContext && exportIntent) return true;
  return /js\.design.*(截图|导出)|设计稿.*(截图|导出|第一张)/i.test(text);
}

function isDesignReplicateLike(text: string): boolean {
  return /复刻|照着|模仿|还原|仿照|clone|replicat|生成.*页|做一?个.*页|页面复刻|网页复刻/i.test(
    text,
  );
}

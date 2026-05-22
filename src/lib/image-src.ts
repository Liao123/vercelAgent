/** 是否需经本站代理才能在内嵌 <img> 中稳定显示 */
export function needsImageProxy(src: string): boolean {
  if (src.startsWith("data:") || src.startsWith("/")) return false;
  try {
    const host = new URL(src).hostname;
    return host === "image.pollinations.ai" || host.endsWith(".pollinations.ai");
  } catch {
    return false;
  }
}

/** 转为可在聊天页内嵌显示的地址（同源代理） */
export function toDisplayImageSrc(src: string): string {
  if (!needsImageProxy(src)) return src;
  return `/api/image-proxy?url=${encodeURIComponent(src)}`;
}

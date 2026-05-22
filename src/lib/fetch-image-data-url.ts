/** 服务端拉取外链图片并转为 base64 data URL（用于 API 直接返回可嵌入图片） */
export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; vec-next/1.0)",
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

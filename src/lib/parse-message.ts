/** 从文本中提取 Markdown / 纯 URL / base64 图片地址 */
export function extractImagesFromText(text: string): string[] {
  const found = new Set<string>();

  // Markdown: ![alt](url)
  const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(text)) !== null) {
    const url = m[1].trim();
    if (isImageSrc(url)) found.add(url);
  }

  // 独立图片 URL
  const urlRe =
    /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"']*)?/gi;
  while ((m = urlRe.exec(text)) !== null) {
    found.add(m[0]);
  }

  // base64 图片
  const b64Re = /data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g;
  while ((m = b64Re.exec(text)) !== null) {
    found.add(m[0]);
  }

  return [...found];
}

function isImageSrc(src: string): boolean {
  return (
    src.startsWith("data:image/") ||
    /^https?:\/\//i.test(src) ||
    src.startsWith("/") // 相对路径
  );
}

/** 解析 OpenAI 兼容接口返回的 message.content（字符串或结构化数组） */
export function parseAssistantPayload(content: unknown): {
  text: string;
  images: string[];
} {
  const images: string[] = [];
  const textParts: string[] = [];

  if (typeof content === "string") {
    textParts.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;

      if (
        (p.type === "text" || p.type === "output_text") &&
        typeof p.text === "string"
      ) {
        textParts.push(p.text);
      }
      if (p.type === "image_url") {
        const url = (p.image_url as { url?: string })?.url;
        if (url) images.push(url);
      }
      // Responses API 等可能返回 output_image
      if (p.type === "output_image" || p.type === "image") {
        const url =
          (p.image_url as { url?: string })?.url ??
          (p.url as string) ??
          (p.b64_json as string)
            ? `data:image/png;base64,${p.b64_json}`
            : undefined;
        if (url) images.push(url);
      }
    }
  } else if (content != null) {
    textParts.push(String(content));
  }

  const text = textParts.join("\n").trim();
  const fromText = extractImagesFromText(text);
  const allImages = [...new Set([...images, ...fromText])];

  return { text, images: allImages };
}

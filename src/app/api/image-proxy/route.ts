/**
 * 图片代理：绕过外链防盗链 / 慢生成，供聊天页 <img> 同源加载
 * GET  /api/image-proxy?url=...
 * POST /api/image-proxy  body: { "url": "..." }
 */
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "image.pollinations.ai",
  "pollinations.ai",
]);

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return (
      ALLOWED_HOSTS.has(u.hostname) ||
      u.hostname.endsWith(".pollinations.ai")
    );
  } catch {
    return false;
  }
}

async function fetchImage(url: string): Promise<Response> {
  const upstream = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; vec-next/1.0)",
      Accept: "image/*",
    },
    // Pollinations 首次生成可能较慢
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `上游返回 ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const contentType =
    upstream.headers.get("content-type") ?? "image/jpeg";
  const buffer = await upstream.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !isAllowedUrl(url)) {
    return NextResponse.json({ error: "无效或未允许的 url" }, { status: 400 });
  }
  return fetchImage(url);
}

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求体" }, { status: 400 });
  }
  const url = body.url;
  if (!url || !isAllowedUrl(url)) {
    return NextResponse.json({ error: "无效或未允许的 url" }, { status: 400 });
  }
  return fetchImage(url);
}

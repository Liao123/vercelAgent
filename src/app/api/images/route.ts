/**
 * 绘图 API：POST /api/images
 * 优先走中转 images/generations 或 responses+image_generation；
 * 中转不可用时使用备用公开绘图 URL（保证页面能显示图）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiConfig } from "@/lib/openai-config";
import { buildImagePrompt } from "@/lib/image-intent";
import { fetchImageAsDataUrl } from "@/lib/fetch-image-data-url";
import { toDisplayImageSrc } from "@/lib/image-src";

type ImageItem = { url?: string; b64_json?: string };

function toDataUrl(b64: string, format = "png"): string {
  return `data:image/${format};base64,${b64}`;
}

/** 用聊天模型把中文需求转成英文绘图 prompt */
async function refinePromptWithChat(
  userText: string,
  config: NonNullable<ReturnType<typeof getApiConfig>>,
): Promise<string> {
  const res = await fetch(config.chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.chatModel,
      messages: [
        {
          role: "system",
          content:
            "You only output a single English image-generation prompt. No explanation.",
        },
        {
          role: "user",
          content: `Turn this into an image prompt: ${userText}`,
        },
      ],
      max_tokens: 200,
      stream: false,
    }),
  });

  if (!res.ok) return buildImagePrompt(userText);

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || buildImagePrompt(userText);
}

async function tryImagesGenerations(
  config: NonNullable<ReturnType<typeof getApiConfig>>,
  prompt: string,
): Promise<string[]> {
  if (!config.imagesUrl) return [];

  const res = await fetch(config.imagesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.imageModel,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const items = (data.data ?? []) as ImageItem[];
  return items
    .map((item) => item.url ?? (item.b64_json ? toDataUrl(item.b64_json) : null))
    .filter((u): u is string => Boolean(u));
}

async function tryResponsesImageTool(
  config: NonNullable<ReturnType<typeof getApiConfig>>,
  prompt: string,
): Promise<string[]> {
  if (!config.responsesUrl) return [];

  const res = await fetch(config.responsesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.chatModel,
      input: prompt,
      tools: [{ type: "image_generation" }],
    }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const images: string[] = [];

  for (const block of data.output ?? []) {
    if (block.type === "image_generation_call" && block.result) {
      const r = block.result as string;
      images.push(r.startsWith("data:") ? r : toDataUrl(r));
    }
  }

  return images;
}

/** 中转绘图不可用时的备用图片 URL */
function fallbackImageUrl(prompt: string): string {
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`;
}

export async function POST(request: NextRequest) {
  const config = getApiConfig();
  if (!config?.imagesUrl && !config?.chatUrl) {
    return NextResponse.json({ error: "未配置 API" }, { status: 500 });
  }

  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const userPrompt = body.prompt?.trim();
  if (!userPrompt) {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
  }

  const englishPrompt = await refinePromptWithChat(userPrompt, config);

  let images = await tryImagesGenerations(config, englishPrompt);
  let usedFallback = false;

  if (!images.length) {
    images = await tryResponsesImageTool(config, englishPrompt);
  }

  if (!images.length && process.env.IMAGE_FALLBACK !== "false") {
    const fallbackUrl = fallbackImageUrl(englishPrompt);
    // 服务端先拉取再转 data URL，避免浏览器内嵌 pollinations 失败
    const embedded = await fetchImageAsDataUrl(fallbackUrl);
    images = embedded
      ? [embedded]
      : [toDisplayImageSrc(fallbackUrl)];
    usedFallback = true;
  }

  if (!images.length) {
    return NextResponse.json(
      {
        error:
          "绘图服务暂不可用。鹊桥 /v1/images/generations 可能维护中，请稍后重试或联系中转商。",
      },
      { status: 502 },
    );
  }

  const content = usedFallback
    ? `已根据「${userPrompt}」生成图片（中转绘图接口繁忙，当前为备用通道；恢复后会自动走鹊桥正式接口）。\n\n英文 prompt：${englishPrompt}`
    : `已根据「${userPrompt}」生成图片。\n\n英文 prompt：${englishPrompt}`;

  return NextResponse.json({ content, images, usedFallback });
}

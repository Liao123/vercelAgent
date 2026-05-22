/**
 * 聊天 API：支持纯文本与图片理解（OpenAI 多模态 messages）
 */
import { NextRequest, NextResponse } from "next/server";
import type { ApiChatMessage } from "@/lib/chat-types";
import { extractAssistantText } from "@/lib/extract-assistant-text";
import { getApiConfig } from "@/lib/openai-config";
import { parseAssistantPayload } from "@/lib/parse-message";

function messageHasImages(msg: ApiChatMessage): boolean {
  return (
    Array.isArray(msg.content) &&
    msg.content.some((p) => p.type === "image_url")
  );
}

export async function POST(request: NextRequest) {
  const config = getApiConfig();

  if (!config) {
    return NextResponse.json(
      {
        error:
          "未配置 API：请设置 OPENAI_API_BASE + OPENAI_API_KEY，或 DEEPSEEK_API_KEY",
      },
      { status: 500 },
    );
  }

  let body: { messages?: ApiChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const messages = body.messages;
  if (!messages?.length) {
    return NextResponse.json({ error: "messages 不能为空" }, { status: 400 });
  }

  const useVision = messages.some(messageHasImages);
  const model = useVision ? config.visionModel : config.chatModel;

  const response = await fetch(config.chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: useVision ? 1500 : undefined,
    }),
  });

  const rawText = await response.text();

  if (!response.ok) {
    return NextResponse.json(
      { error: `${config.provider} API 错误: ${rawText}` },
      { status: response.status },
    );
  }

  let data: {
    choices?: { message?: Record<string, unknown>; finish_reason?: string }[];
    error?: { message?: string };
  };

  try {
    data = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { error: "API 返回了无法解析的响应" },
      { status: 502 },
    );
  }

  if (data.error?.message) {
    return NextResponse.json({ error: data.error.message }, { status: 502 });
  }

  const choice = data.choices?.[0];
  const message = choice?.message;
  const rawContent = message?.content;
  const { text, images } = parseAssistantPayload(rawContent);
  let content = text || extractAssistantText(message);

  if (!content) {
    const reason = choice?.finish_reason ?? "unknown";
    return NextResponse.json(
      {
        error:
          useVision
            ? `模型返回为空（finish_reason: ${reason}）。请尝试换 OPENAI_VISION_MODEL=gpt-5.4，或换一张更小的图片。`
            : `模型返回为空（finish_reason: ${reason}）`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    content,
    images,
    model,
  });
}

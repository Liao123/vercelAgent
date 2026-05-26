/**
 * Existing chat API, now routed through ModelProvider.
 *
 * 这个接口保持原聊天 UI 可用，同时让模型调用开始走 agent/model 抽象层。
 */
import { createChatCompletionsProvider } from "@/agent/model";
import type { ApiChatMessage } from "@/lib/chat-types";
import { getApiConfig } from "@/lib/openai-config";

function messageHasImages(message: ApiChatMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );
}

export async function POST(request: Request) {
  const config = getApiConfig();

  if (!config) {
    return Response.json(
      {
        error:
          "API is not configured. Set OPENAI_API_BASE + OPENAI_API_KEY, or DEEPSEEK_API_KEY.",
      },
      { status: 500 },
    );
  }

  let body: { messages?: ApiChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages = body.messages;
  if (!messages?.length) {
    return Response.json({ error: "messages is required." }, { status: 400 });
  }

  const useVision = messages.some(messageHasImages);
  const model = useVision ? config.visionModel : config.chatModel;
  const provider = createChatCompletionsProvider(config);

  try {
    const output = await provider.generate({
      model,
      messages,
      maxTokens: useVision ? 1500 : undefined,
    });

    return Response.json({
      content: output.content,
      images: output.images,
      model: output.model,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Model request failed.",
      },
      { status: 502 },
    );
  }
}

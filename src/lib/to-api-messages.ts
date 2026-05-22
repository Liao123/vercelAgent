import type { ApiChatMessage, ChatMessage, ContentPart } from "@/lib/chat-types";

/** 将前端消息转为 OpenAI Chat Completions 格式（含 vision 图片） */
export function toApiMessages(messages: ChatMessage[]): ApiChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === "user" && msg.images?.length) {
      const parts: ContentPart[] = [];

      const text =
        msg.content.trim() ||
        "请详细描述并分析我上传的图片（内容、物体、文字、场景等）。";
      parts.push({ type: "text", text });

      for (const url of msg.images) {
        parts.push({
          type: "image_url",
          // low 更省 token，大图更稳定；解析细节仍足够
          image_url: { url, detail: "low" },
        });
      }

      return { role: "user", content: parts };
    }

    return { role: msg.role, content: msg.content };
  });
}

/** 当前对话是否包含用户上传的图片 */
export function hasVisionInput(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === "user" && (m.images?.length ?? 0) > 0);
}

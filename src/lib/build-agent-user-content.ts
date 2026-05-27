import type {
  AgentContent,
  AgentImageContentPart,
  AgentTextContentPart,
} from "@/agent/types";

/** 将任务文字与参考图（data URL）组装为 Agent 多模态 user content。 */
export function buildAgentUserContent(
  text: string,
  imageDataUrls?: string[],
): AgentContent {
  const trimmed = text.trim();
  const images = (imageDataUrls ?? []).filter((url) => url.startsWith("data:image/"));

  if (images.length === 0) {
    return trimmed;
  }

  const parts: Array<AgentTextContentPart | AgentImageContentPart> = [
    {
      type: "text",
      text: trimmed || "请参考附图完成上述开发任务。",
    },
  ];

  for (const url of images) {
    parts.push({
      type: "image_url",
      image_url: { url, detail: "low" },
    });
  }

  return parts;
}

export function agentMessagesHaveImages(
  messages: Array<{ content: AgentContent }>,
): boolean {
  return messages.some((message) => {
    if (typeof message.content === "string") return false;
    return message.content.some((part) => part.type === "image_url");
  });
}

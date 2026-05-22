/** 从 Chat Completions 的 message 对象提取可读文本 */
export function extractAssistantText(message: Record<string, unknown> | undefined): string {
  if (!message) return "";

  const { text } = parseContentField(message.content);
  if (text) return text;

  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }

  if (typeof message.refusal === "string" && message.refusal.trim()) {
    return `模型拒绝回答：${message.refusal}`;
  }

  return "";
}

function parseContentField(content: unknown): { text: string } {
  if (typeof content === "string") return { text: content.trim() };

  if (!Array.isArray(content)) {
    return { text: content != null ? String(content).trim() : "" };
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (
      (p.type === "text" || p.type === "output_text") &&
      typeof p.text === "string"
    ) {
      parts.push(p.text);
    }
  }
  return { text: parts.join("\n").trim() };
}

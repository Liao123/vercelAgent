/** OpenAI 兼容多模态消息片段 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

/** 发给 /api/chat 的单条消息 */
export type ApiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
};

/** 前端聊天列表展示用 */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** data URL，用于展示与再次提交多轮对话 */
  images?: string[];
};

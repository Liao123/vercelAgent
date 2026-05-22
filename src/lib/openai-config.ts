/** 解析 OpenAI 兼容中转的 API 根地址 */
export function resolveApiRoot(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

export function resolveChatUrl(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

export function resolveImagesUrl(base: string): string {
  return `${resolveApiRoot(base)}/images/generations`;
}

export function resolveResponsesUrl(base: string): string {
  return `${resolveApiRoot(base)}/responses`;
}

export type ApiConfig = {
  apiKey: string;
  chatUrl: string;
  imagesUrl: string;
  responsesUrl: string;
  chatModel: string;
  /** 带图对话时使用的视觉模型 */
  visionModel: string;
  imageModel: string;
  provider: string;
};

/** 读取环境变量中的 API 配置 */
export function getApiConfig(): ApiConfig | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_API_BASE;

  if (openaiKey && openaiBase) {
    return {
      apiKey: openaiKey,
      chatUrl: resolveChatUrl(openaiBase),
      imagesUrl: resolveImagesUrl(openaiBase),
      responsesUrl: resolveResponsesUrl(openaiBase),
      chatModel: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
      visionModel:
        process.env.OPENAI_VISION_MODEL ??
        process.env.OPENAI_MODEL ??
        "gpt-5.4-mini",
      imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
      provider: "OpenAI 兼容中转",
    };
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    return {
      apiKey: deepseekKey,
      chatUrl: "https://api.deepseek.com/chat/completions",
      imagesUrl: "",
      responsesUrl: "",
      chatModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      visionModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      imageModel: "",
      provider: "DeepSeek",
    };
  }

  return null;
}

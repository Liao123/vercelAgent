/**
 * 将模型 / 中转 API 错误整理成可展示的一行中文（禁止 HTML 进 UI）。
 * Cursor 式：透传真实信息，不替用户断定「API 超时」。
 */
const DEFAULT_MAX = 280;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parseHtmlErrorPage(html: string): string | null {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
  const parts = [title, h1].filter(Boolean);
  if (parts.length > 0) {
    return `模型服务返回 HTML 错误页（非 JSON）：${parts.join(" · ").slice(0, 200)}`;
  }
  return "模型服务返回 HTML 错误页（非 JSON）。请检查 .env.local 中的 API 地址与 Key。";
}

export function formatModelErrorMessage(
  raw: unknown,
  maxLen = DEFAULT_MAX,
): string {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : String(raw);

  const withoutPrefix = text.replace(
    /^(?:OpenAI\s*兼容中转|OpenAI-compatible)\s*API\s*error:\s*/i,
    "",
  );

  if (/<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(withoutPrefix)) {
    return parseHtmlErrorPage(withoutPrefix) ?? "模型服务返回异常 HTML 响应。";
  }

  let message = collapseWhitespace(withoutPrefix);
  if (!message) return "模型调用失败（未知错误）。";

  if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
    return "无法连接模型 API。请检查网络与 .env.local 中的地址。";
  }
  if (/invalid json|returned invalid json/i.test(message)) {
    return "模型 API 返回了无效 JSON。请检查中转服务是否正常。";
  }
  if (
    /rate_limit_error|concurrency limit exceeded|too many requests/i.test(
      message,
    )
  ) {
    return "API 并发/频率超限（rate_limit）。请等待 1–2 分钟后重试，或减少同时运行的 Agent 任务。";
  }
  if (/empty content|finish_reason/i.test(message)) {
    return "模型返回空内容。请重试或更换模型。";
  }
  if (
    /no tool call found for function call output/i.test(message) ||
    /invalid_request_error.*tool_call/i.test(message)
  ) {
    return "对话历史里 tool 消息顺序异常。请新开任务重试；若仍出现请反馈给开发。";
  }

  if (message.length > maxLen) {
    message = `${message.slice(0, maxLen)}…`;
  }
  return message;
}

export function formatModelFailureSummary(error: unknown): string {
  return `模型调用失败：${formatModelErrorMessage(error)}`;
}

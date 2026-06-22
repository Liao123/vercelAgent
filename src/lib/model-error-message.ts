/**
 * 将模型 / 中转 API 错误整理成可展示的一行中文（禁止 HTML 进 UI）。
 */
const DEFAULT_MAX = 280;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parseHtmlErrorPage(html: string): string | null {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
  const blob = `${title ?? ""} ${h1 ?? ""}`.toLowerCase();

  if (/524|timeout occurred|a timeout occurred/.test(blob)) {
    return "API 中转超时（524）。请稍后重试，或更换模型 / 检查 API 中转服务是否可用。";
  }
  if (/\b502\b|bad gateway/.test(blob)) {
    return "API 网关错误（502）。请稍后重试。";
  }
  if (/\b503\b|service unavailable/.test(blob)) {
    return "API 服务暂不可用（503）。请稍后重试。";
  }
  if (/\b504\b|gateway timeout/.test(blob)) {
    return "API 网关超时（504）。请稍后重试。";
  }
  if (/\b429\b|rate limit|too many requests/.test(blob)) {
    return "API 请求过于频繁（429）。请稍后再试。";
  }
  if (title) {
    return `API 返回 HTML 错误页：${title.slice(0, 140)}`;
  }
  if (h1) {
    return `API 错误：${h1.slice(0, 140)}`;
  }
  return "API 返回 HTML 错误页（非 JSON）。请检查中转服务或 .env.local 中的 API 配置。";
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
    return parseHtmlErrorPage(withoutPrefix) ?? "API 返回异常 HTML 响应。";
  }

  let message = collapseWhitespace(withoutPrefix);
  if (!message) return "模型调用失败（未知错误）。";

  if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
    return "无法连接模型 API。请检查网络与 .env.local 中的地址。";
  }
  if (/invalid json|returned invalid json/i.test(message)) {
    return "模型 API 返回了无效 JSON。请检查中转服务是否正常。";
  }
  if (/empty content|finish_reason/i.test(message)) {
    return "模型返回空内容。请重试或更换模型。";
  }

  if (message.length > maxLen) {
    message = `${message.slice(0, maxLen)}…`;
  }
  return message;
}

export function formatModelFailureSummary(error: unknown): string {
  return `模型调用失败：${formatModelErrorMessage(error)}`;
}

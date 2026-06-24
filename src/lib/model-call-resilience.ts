/**
 * 模型 API 调用韧性：可重试错误识别 + 退避（A154）。
 */
import { formatModelErrorMessage } from "@/lib/model-error-message";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isModelCallRetryEnabled(): boolean {
  return process.env.AGENT_MODEL_RETRY !== "0";
}

export function modelCallMaxRetries(): number {
  if (!isModelCallRetryEnabled()) return 0;
  const raw = process.env.AGENT_MODEL_RETRY_MAX;
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

export function isRetriableModelError(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const message = `${raw} ${formatModelErrorMessage(error)}`.toLowerCase();
  return (
    /524|502|503|504|429/.test(message) ||
    /rate_limit|concurrency limit|too many requests/.test(message) ||
    /html 错误页|html error/.test(message) ||
    /timeout|超时|gateway|temporarily unavailable|rate limit|fetch failed|econnreset|enotfound/.test(
      message,
    )
  );
}

export async function withModelCallRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; delayMs?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? modelCallMaxRetries();
  const delayMs = options?.delayMs ?? 2_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetriableModelError(error)) {
        throw error;
      }
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}

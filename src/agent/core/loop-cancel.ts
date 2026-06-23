/**
 * A165：Loop 用户取消（AbortSignal / 客户端断开）。
 */
export const LOOP_USER_CANCEL_MESSAGE = "用户已停止运行";

export class LoopCancelledError extends Error {
  readonly cancelled = true;

  constructor(message = LOOP_USER_CANCEL_MESSAGE) {
    super(message);
    this.name = "LoopCancelledError";
  }
}

export function isLoopCancelledError(error: unknown): boolean {
  return error instanceof LoopCancelledError;
}

export function isLoopAbortSignal(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

export function throwIfLoopCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LoopCancelledError();
  }
}

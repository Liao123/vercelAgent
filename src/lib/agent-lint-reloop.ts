import type { PostExecuteVerification } from "@/agent/verification/post-execute-verify";

export const AUTO_RELOOP_ON_LINT_FAIL_KEY = "vec.agent.autoReloopOnLintFail";

export function readAutoReloopOnLintFail(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(AUTO_RELOOP_ON_LINT_FAIL_KEY);
  if (stored === null) return true;
  return stored === "1";
}

export function writeAutoReloopOnLintFail(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_RELOOP_ON_LINT_FAIL_KEY, enabled ? "1" : "0");
}

/** 用户是否在延续「修 lint/执行后验证失败」任务（否则应清掉陈旧 checkpoint）。 */
export function isPostExecuteFixContinuation(request: string): boolean {
  const text = request.trim();
  if (!text) return false;
  return (
    /上一轮写盘|执行后验证|lint|typecheck|file\.replace\.prepare/i.test(text) ||
    /修复.*错误|验证.*未通过|mock failure/i.test(text)
  );
}

export function shouldOfferLintReloop(
  verification: PostExecuteVerification | undefined,
): verification is PostExecuteVerification {
  return Boolean(verification?.triggered && !verification.success);
}

/** 预填 Loop 输入：结合 A086 执行后验证失败信息。 */
export function buildLintFixLoopRequest(
  verification: PostExecuteVerification,
): string {
  const failed = verification.results.find((item) => !item.success);
  const outputExcerpt = (failed?.output ?? verification.summary).slice(0, 2_000);
  const paths =
    verification.changedPaths.length > 0
      ? verification.changedPaths.join("、")
      : "（见 lint 输出）";

  return [
    "上一轮写盘后的 lint/typecheck 未通过，请修复错误并重新 file.replace.prepare 生成审批，不要猜测 search 字符串。",
    `涉及文件：${paths}`,
    failed?.command ? `失败命令：npm run ${failed.command}` : "",
    "错误输出：",
    outputExcerpt,
  ]
    .filter(Boolean)
    .join("\n");
}

import type { AgentEvent } from "@/agent/types";
import type { PostExecuteVerification } from "@/agent/verification";

/** 从本轮事件流中的 verification.completed 聚合执行后验证（中栏展示用）。 */
export function postExecuteVerificationFromTurnEvents(
  events: AgentEvent[],
): PostExecuteVerification | null {
  const hits = events.filter(
    (event): event is Extract<AgentEvent, { type: "verification.completed" }> =>
      event.type === "verification.completed",
  );
  if (hits.length === 0) return null;

  const results = hits.map((event) => event.result);
  const success = results.every((item) => item.success);
  const failed = results.find((item) => !item.success);

  return {
    triggered: true,
    changedPaths: [],
    results,
    success,
    summary: success
      ? `执行后验证通过：${results.map((item) => item.command).join(" → ")}。`
      : `执行后验证失败：${failed?.command ?? "unknown"}。`,
    completedAt: results[results.length - 1]?.completedAt ?? new Date().toISOString(),
  };
}

export function extractPostExecuteVerification(
  executionResult: unknown,
): PostExecuteVerification | undefined {
  if (!executionResult || typeof executionResult !== "object") return undefined;
  const verify = (executionResult as { postExecuteVerification?: PostExecuteVerification })
    .postExecuteVerification;
  return verify?.triggered ? verify : undefined;
}

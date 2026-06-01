import type { PostExecuteVerification } from "@/agent/verification";

export function extractPostExecuteVerification(
  executionResult: unknown,
): PostExecuteVerification | undefined {
  if (!executionResult || typeof executionResult !== "object") return undefined;
  const verify = (executionResult as { postExecuteVerification?: PostExecuteVerification })
    .postExecuteVerification;
  return verify?.triggered ? verify : undefined;
}

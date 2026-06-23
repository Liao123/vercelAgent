/**
 * 阶段 B：韧性恢复总开关（默认开，设 AGENT_LOOP_GRACEFUL_RECOVERY=0 关闭）。
 */
export function isGracefulRecoveryEnabled(): boolean {
  return process.env.AGENT_LOOP_GRACEFUL_RECOVERY !== "0";
}

/** 模型不可用时对环境/截图类任务走确定性兜底（无 LLM）。 */
export function isDeterministicRecoveryEnabled(): boolean {
  if (process.env.AGENT_LOOP_DETERMINISTIC_RECOVERY === "0") return false;
  return isGracefulRecoveryEnabled();
}

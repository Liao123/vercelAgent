/**
 * Agent Loop 压缩阈值（可通过环境变量调优，便于长任务实机对比）。
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const LOOP_COMPACTION_CONFIG = {
  tailKeepCount: readPositiveInt("AGENT_LOOP_TAIL_KEEP", 12),
  middleMessageTrigger: readPositiveInt("AGENT_LOOP_MIDDLE_MSG_TRIGGER", 8),
  middleTokenTrigger: readPositiveInt("AGENT_LOOP_MIDDLE_TOKEN_TRIGGER", 4_000),
};

export function isSemanticCompactEnabled(): boolean {
  return process.env.AGENT_LOOP_SEMANTIC_COMPACT !== "false";
}

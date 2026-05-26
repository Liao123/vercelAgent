/**
 * Token Budget 管理。
 *
 * 这里不依赖模型 tokenizer，先使用项目内统一的粗略估算。
 * 目标是保证每次模型请求前能知道：能放多少上下文、该不该压缩、哪些 section 被保留。
 */
import type {
  ContextSection,
  TokenBudgetConfig,
  TokenBudgetResult,
} from "@/agent/memory/types";

export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = {
  maxInputTokens: 32_000,
  reservedOutputTokens: 4_000,
  compressionThresholdRatio: 0.85,
};

export function getMaxContextTokens(config: TokenBudgetConfig): number {
  return Math.max(0, config.maxInputTokens - config.reservedOutputTokens);
}

export function applyTokenBudget(
  sections: ContextSection[],
  config: TokenBudgetConfig = DEFAULT_TOKEN_BUDGET,
): TokenBudgetResult {
  const maxContextTokens = getMaxContextTokens(config);
  const sorted = [...sections].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.estimatedTokens - b.estimatedTokens;
  });
  const includedSections: ContextSection[] = [];
  const droppedSections: ContextSection[] = [];
  let estimatedTokens = 0;

  for (const section of sorted) {
    if (estimatedTokens + section.estimatedTokens <= maxContextTokens) {
      includedSections.push(section);
      estimatedTokens += section.estimatedTokens;
    } else {
      droppedSections.push(section);
    }
  }

  const compressionThreshold = Math.floor(
    maxContextTokens * config.compressionThresholdRatio,
  );

  return {
    config,
    maxContextTokens,
    estimatedTokens,
    overBudget: droppedSections.length > 0,
    shouldCompress:
      droppedSections.length > 0 || estimatedTokens >= compressionThreshold,
    includedSections,
    droppedSections,
  };
}

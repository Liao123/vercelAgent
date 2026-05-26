/**
 * Agent 上下文管理类型。
 *
 * 这里把一次模型请求需要的上下文拆成稳定分层，后续做压缩、预算和检索时，
 * 都围绕这些 ContextSection 工作。
 */
import type { AgentMessage, Task, Thread, Turn } from "@/agent/types";
import type { ProjectRuleFile } from "@/agent/tools";

export type ContextSectionKind =
  | "system"
  | "project_rules"
  | "thread_memory"
  | "task_memory"
  | "turn_context"
  | "retrieved_context"
  | "tool_result";

export type ContextSection = {
  id: string;
  kind: ContextSectionKind;
  title: string;
  content: string;
  priority: number;
  estimatedTokens: number;
  source?: string;
};

export type ContextBuildInput = {
  systemInstructions: string;
  projectRules: ProjectRuleFile[];
  thread?: Thread;
  threadSummary?: string;
  task?: Task;
  taskSummary?: string;
  turn?: Turn;
  recentMessages?: AgentMessage[];
  retrievedContext?: ContextSection[];
  toolResults?: ContextSection[];
};

export type ContextBuildResult = {
  sections: ContextSection[];
  messages: AgentMessage[];
  estimatedTokens: number;
};

export type ContextSummaryScope = "thread" | "task" | "turn" | "tool";

export type ContextSummary = {
  id: string;
  scope: ContextSummaryScope;
  sourceSectionIds: string[];
  title: string;
  summary: string;
  facts: string[];
  openQuestions: string[];
  changedFiles: string[];
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  createdAt: string;
};

export type ContextCompressionInput = {
  scope: ContextSummaryScope;
  sections: ContextSection[];
  maxSectionChars?: number;
  maxFacts?: number;
};

export type ContextCompressionResult = {
  summary: ContextSummary;
  section: ContextSection;
};

export type TokenBudgetConfig = {
  maxInputTokens: number;
  reservedOutputTokens: number;
  compressionThresholdRatio: number;
};

export type TokenBudgetResult = {
  config: TokenBudgetConfig;
  maxContextTokens: number;
  estimatedTokens: number;
  overBudget: boolean;
  shouldCompress: boolean;
  includedSections: ContextSection[];
  droppedSections: ContextSection[];
};

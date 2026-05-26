/**
 * 模型供应商抽象层类型。
 *
 * Agent Core 只依赖 ModelProvider，不直接依赖 OpenAI、DeepSeek 或其他厂商 API。
 * 后续新增模型时，只需要实现这个接口。
 */
import type { AgentMessage } from "@/agent/types";

export type ModelInput = {
  messages: AgentMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
};

export type ModelOutput = {
  content: string;
  images: string[];
  model: string;
  finishReason?: string;
  rawContent?: unknown;
  raw?: unknown;
};

export type ModelStreamEvent =
  | { type: "delta"; text: string; raw?: unknown }
  | { type: "completed"; output?: ModelOutput }
  | { type: "error"; error: string };

export interface ModelProvider {
  name: string;
  generate(input: ModelInput): Promise<ModelOutput>;
  stream(input: ModelInput): AsyncIterable<ModelStreamEvent>;
}

/**
 * 模型层统一出口。
 *
 * 业务代码优先从这里创建 provider，不要直接 new 某个具体模型实现。
 */
import { getApiConfig } from "@/lib/openai-config";
import type { ApiConfig } from "@/lib/openai-config";
import { ChatCompletionsProvider } from "@/agent/model/chat-completions-provider";
import type { ModelProvider } from "@/agent/model/types";

export function createChatCompletionsProvider(
  config: ApiConfig,
): ModelProvider {
  return new ChatCompletionsProvider(config);
}

export function createConfiguredModelProvider(): ModelProvider | null {
  const config = getApiConfig();
  if (!config) return null;
  return createChatCompletionsProvider(config);
}

export type {
  ModelInput,
  ModelOutput,
  ModelProvider,
  ModelStreamEvent,
} from "@/agent/model/types";

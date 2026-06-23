/**
 * Agent Loop 工具 → OpenAI Chat Completions `tools` schema（A114）。
 */
import { AGENT_LOOP_TOOLS } from "@/agent/core/agent-loop-tools";
import { getMcpToolDefinitions } from "@/agent/mcp/registry";
import { decodeMcpApiToolName } from "@/agent/mcp/registry";
import type { ModelToolDefinition, ModelToolCall } from "@/agent/model/types";
import { repairOpenAiAssistantToolPairs } from "@/agent/model/repair-openai-tool-messages";
import type { AgentMessage } from "@/agent/types";

let cachedDefinitions: ModelToolDefinition[] | null = null;
let cachedApiToInternal: Map<string, string> | null = null;

/** OpenAI tools API：`name` 仅允许 `[a-zA-Z0-9_-]`，内部 `file.read` → `file_read`。 */
export function encodeOpenAiToolName(internalName: string): string {
  return internalName.replace(/\./g, "_");
}

function getApiToInternalMap(): Map<string, string> {
  if (!cachedApiToInternal) {
    cachedApiToInternal = new Map(
      AGENT_LOOP_TOOLS.map((tool) => [encodeOpenAiToolName(tool.name), tool.name]),
    );
  }
  return cachedApiToInternal;
}

export function decodeOpenAiToolName(apiName: string): string {
  const fromBuiltin = getApiToInternalMap().get(apiName);
  if (fromBuiltin) return fromBuiltin;
  const fromMcp = decodeMcpApiToolName(apiName);
  if (fromMcp) return fromMcp;
  return apiName;
}

/** MCP 工具加载后需调用以刷新合并 schema */
export function invalidateLoopToolDefinitionCache(): void {
  cachedDefinitions = null;
}

export function serializeAgentMessagesForOpenAiApi(
  messages: AgentMessage[],
): AgentMessage[] {
  return repairOpenAiAssistantToolPairs(messages).map((message) => {
    if (!message.tool_calls?.length) return message;
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => ({
        ...call,
        function: {
          ...call.function,
          name: encodeOpenAiToolName(call.function.name),
        },
      })),
    };
  });
}

function argPropertySchema(description: string): Record<string, unknown> {
  const lower = description.toLowerCase();
  if (lower.includes("boolean") || lower.startsWith("optional boolean")) {
    return { type: "boolean", description };
  }
  if (lower.includes("number") || lower.includes("integer")) {
    return { type: "number", description };
  }
  if (lower.includes("array") || lower.includes("string array")) {
    return {
      type: "array",
      items: { type: "string" },
      description,
    };
  }
  return { type: "string", description };
}

export function buildLoopToolDefinitions(): ModelToolDefinition[] {
  if (cachedDefinitions) return cachedDefinitions;

  const builtin = AGENT_LOOP_TOOLS.map((tool) => {
    const properties = Object.fromEntries(
      Object.entries(tool.args).map(([key, description]) => [
        key,
        argPropertySchema(description),
      ]),
    );
    const required = Object.keys(tool.args).filter((key) => {
      const desc = tool.args[key] ?? "";
      return !/^optional/i.test(desc);
    });

    return {
      type: "function" as const,
      function: {
        name: encodeOpenAiToolName(tool.name),
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: true,
        },
      },
    };
  });

  cachedDefinitions = [...builtin, ...getMcpToolDefinitions()];
  return cachedDefinitions;
}

export function parseToolCallArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new Error(`Tool arguments are not valid JSON: ${trimmed.slice(0, 200)}`);
}

export function parseOpenAiToolCalls(
  message: Record<string, unknown> | undefined,
): ModelToolCall[] {
  const rawCalls = message?.tool_calls;
  if (!Array.isArray(rawCalls)) return [];

  const calls: ModelToolCall[] = [];
  for (const item of rawCalls) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const fn = record.function;
    if (!id || !fn || typeof fn !== "object") continue;
    const func = fn as Record<string, unknown>;
    const name = typeof func.name === "string" ? decodeOpenAiToolName(func.name) : "";
    const args =
      typeof func.arguments === "string" ? func.arguments : "{}";
    if (!name) continue;
    calls.push({ id, name, arguments: args });
  }
  return calls;
}

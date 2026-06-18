/**
 * Loop 压缩分层（对标 Claude Code：Snip → Micro → Auto → Reactive → Collapse）。
 *
 * 参考本地 clone：`D:\案例\claude-code-claude` → `src/services/compact/*`
 */
import type { AgentMessage } from "@/agent/types";
import { estimateTokens } from "@/agent/memory/context-manager";

export const MICRO_OBSERVATION_STUB =
  "[Older tool result cleared — see [COMPACTED_MEMORY] snippets]";

/** A118：soft collapse 占位（不 merge memory，可 file.read / 重调工具） */
export const SOFT_TOOL_COLLAPSE_STUB =
  "[Older tool result collapsed — re-call tool or file.read storagePath if externalized]";

export const COLLAPSE_TAIL_KEEP = 4;
export const SOFT_TOOL_PROTECT_RECENT = 6;

function messageText(message: AgentMessage): string {
  if (message.role === "tool") {
    const body =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    return `Tool result (${message.tool_call_id ?? "?"}): ${body}`;
  }
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

export function isContextOverflowError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  const lower = text.toLowerCase();
  return (
    lower.includes("context") ||
    lower.includes("maximum") ||
    lower.includes("too long") ||
    lower.includes("too many tokens") ||
    lower.includes("token limit") ||
    lower.includes("prompt_too_long") ||
    lower.includes("context_length_exceeded") ||
    lower.includes("413")
  );
}

function isReflectAssistantMessage(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  try {
    const parsed = JSON.parse(messageText(message)) as { action?: string };
    return parsed.action === "reflect";
  } catch {
    return false;
  }
}

function isRuntimeReflectionUserMessage(message: AgentMessage): boolean {
  const text = messageText(message);
  return (
    message.role === "user" &&
    text.includes("Reflection (") &&
    !text.includes("approval_")
  );
}

/** Layer 1：剪掉 middle 里最老的纯反思轮次。 */
export function snipLowValueMiddleMessages(middle: AgentMessage[]): {
  messages: AgentMessage[];
  removedCount: number;
} {
  const next = [...middle];
  let removedCount = 0;
  const minKeep = 6;
  const maxRemove = Math.max(0, next.length - minKeep);

  while (removedCount < maxRemove && next.length > minKeep) {
    const head = next[0];
    const second = next[1];
    const snipPair =
      (isReflectAssistantMessage(head) &&
        second &&
        isRuntimeReflectionUserMessage(second)) ||
      (head &&
        isRuntimeReflectionUserMessage(head) &&
        !messageText(head).includes("Observation from"));

    if (!snipPair) break;

    if (isReflectAssistantMessage(head) && second) {
      next.splice(0, 2);
      removedCount += 2;
    } else {
      next.splice(0, 1);
      removedCount += 1;
    }
  }

  return { messages: next, removedCount };
}

const MICRO_COMPACTABLE_TOOLS = new Set([
  "file.read",
  "file.search",
  "project.index",
  "ui.trace_from_page",
  "jsx.find_text",
  "symbol.find_references",
]);

function observationBodyText(message: AgentMessage): string {
  if (message.role === "tool") {
    return typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content ?? "");
  }
  return messageText(message);
}

function parseObservationToolName(text: string): string | null {
  const match = /Observation from ([^:]+):/.exec(text);
  return match?.[1]?.trim() ?? null;
}

/** Layer 2：middle 里过大的 tool observation 替换为 stub（JSON user 观测 + 原生 role:tool）。 */
export function microCompactMiddleObservations(middle: AgentMessage[]): {
  messages: AgentMessage[];
  compactedCount: number;
} {
  let compactedCount = 0;
  const next = middle.map((message) => {
    const body = observationBodyText(message);
    const isJsonObservation =
      message.role === "user" && body.startsWith("Observation from ");
    const isNativeTool = message.role === "tool";
    if (!isJsonObservation && !isNativeTool) return message;

    const toolName = parseObservationToolName(body) ?? "";
    if (!MICRO_COMPACTABLE_TOOLS.has(toolName)) return message;
    const tokenEstimate = estimateTokens(isNativeTool ? body : messageText(message));
    if (tokenEstimate < 1_200) return message;

    compactedCount += 1;
    const firstLine = body.split("\n")[0] ?? body.slice(0, 120);
    if (isNativeTool) {
      return {
        role: "tool" as const,
        tool_call_id: message.tool_call_id,
        content: `${firstLine}\n${MICRO_OBSERVATION_STUB}`,
      };
    }
    return {
      role: "user" as const,
      content: `${firstLine}\n${MICRO_OBSERVATION_STUB}`,
    };
  });

  return { messages: next, compactedCount };
}

export function needsEmergencyCollapse(
  estimatedTokens: number,
  maxContextTokens: number,
): boolean {
  const ratio = Number.parseFloat(
    process.env.AGENT_LOOP_COLLAPSE_RATIO ?? "0.96",
  );
  const threshold = maxContextTokens * (Number.isFinite(ratio) ? ratio : 0.96);
  return estimatedTokens > threshold;
}

export function isSoftToolCollapseEnabled(): boolean {
  return process.env.AGENT_LOOP_SOFT_COLLAPSE !== "0";
}

/** A118：在 emergency 之前折叠 middle 里过旧的 tool 观测（不写入 [COMPACTED_MEMORY]）。 */
export function needsSoftToolCollapse(
  estimatedTokens: number,
  maxContextTokens: number,
): boolean {
  const ratio = Number.parseFloat(
    process.env.AGENT_LOOP_SOFT_COLLAPSE_RATIO ?? "0.70",
  );
  const threshold = maxContextTokens * (Number.isFinite(ratio) ? ratio : 0.7);
  return estimatedTokens > threshold;
}

export function isToolObservationMessage(message: AgentMessage): boolean {
  if (message.role === "tool") return true;
  if (message.role !== "user") return false;
  return messageText(message).startsWith("Observation from ");
}

function isAlreadyToolObservationStub(message: AgentMessage): boolean {
  const text = messageText(message);
  return (
    text.includes(MICRO_OBSERVATION_STUB) ||
    text.includes(SOFT_TOOL_COLLAPSE_STUB)
  );
}

function stubToolObservationMessage(message: AgentMessage): AgentMessage {
  if (message.role === "tool") {
    const raw =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    const firstLine = raw.split("\n")[0] ?? "[tool result]";
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: `${firstLine}\n${SOFT_TOOL_COLLAPSE_STUB}`,
    };
  }

  const text = messageText(message);
  const firstLine = text.split("\n")[0] ?? text.slice(0, 120);
  return {
    role: "user",
    content: `${firstLine}\n${SOFT_TOOL_COLLAPSE_STUB}`,
  };
}

/** Layer 2.5：middle 内过旧 tool 观测折叠为 stub（保留最近 N 条）。 */
export function softCollapseMiddleToolObservations(
  middle: AgentMessage[],
  options?: { protectRecentCount?: number },
): { messages: AgentMessage[]; collapsedCount: number } {
  const protectRecentCount = options?.protectRecentCount ?? SOFT_TOOL_PROTECT_RECENT;
  const toolIndices: number[] = [];

  for (let index = 0; index < middle.length; index += 1) {
    const message = middle[index]!;
    if (
      isToolObservationMessage(message) &&
      !isAlreadyToolObservationStub(message)
    ) {
      toolIndices.push(index);
    }
  }

  if (toolIndices.length <= protectRecentCount) {
    return { messages: middle, collapsedCount: 0 };
  }

  const stubIndices = new Set(
    toolIndices.slice(0, toolIndices.length - protectRecentCount),
  );
  let collapsedCount = 0;
  const messages = middle.map((message, index) => {
    if (!stubIndices.has(index)) return message;
    collapsedCount += 1;
    return stubToolObservationMessage(message);
  });

  return { messages, collapsedCount };
}

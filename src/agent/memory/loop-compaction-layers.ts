/**
 * Loop 压缩分层（对标 Claude Code：Snip → Micro → Auto → Reactive → Collapse）。
 *
 * 参考本地 clone：`D:\案例\claude-code-claude` → `src/services/compact/*`
 */
import type { AgentMessage } from "@/agent/types";
import { estimateTokens } from "@/agent/memory/context-manager";

export const MICRO_OBSERVATION_STUB =
  "[Older tool result cleared — see [COMPACTED_MEMORY] snippets]";

export const COLLAPSE_TAIL_KEEP = 4;

function messageText(message: AgentMessage): string {
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

/** Layer 2：middle 里过大的 tool observation 替换为 stub。 */
export function microCompactMiddleObservations(middle: AgentMessage[]): {
  messages: AgentMessage[];
  compactedCount: number;
} {
  let compactedCount = 0;
  const next = middle.map((message) => {
    const text = messageText(message);
    if (!text.startsWith("Observation from ")) return message;

    const toolMatch = /^Observation from ([^:]+):/m.exec(text);
    const toolName = toolMatch?.[1]?.trim() ?? "";
    if (!MICRO_COMPACTABLE_TOOLS.has(toolName)) return message;
    if (estimateTokens(text) < 1_200) return message;

    compactedCount += 1;
    const firstLine = text.split("\n")[0] ?? text.slice(0, 120);
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

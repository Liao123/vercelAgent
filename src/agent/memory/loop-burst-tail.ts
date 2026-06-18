/**
 * A126：爆发段感知 tail — 在 min/max 窗口内尽量保留完整语义链（对标 F148 智能窗口，单 Agent 版）。
 */
import type { AgentMessage } from "@/agent/types";

export function isBurstTailEnabled(): boolean {
  return process.env.AGENT_LOOP_BURST_TAIL !== "0";
}

function localMessageText(message: AgentMessage): string {
  if (message.role === "tool") {
    const body =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    return `Tool result (${message.tool_call_id ?? "?"}): ${body}`;
  }
  if (message.tool_calls?.length) {
    const names = message.tool_calls.map((call) => call.function.name).join(", ");
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
          ? JSON.stringify(message.content)
          : "";
    return `Assistant tool_calls [${names}]${text ? `: ${text}` : ""}`;
  }
  if (message.content == null) return "";
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

function isObservationUserMessage(message: AgentMessage): boolean {
  return (
    message.role === "user" &&
    localMessageText(message).startsWith("Observation from ")
  );
}

/** 非 ephemeral 的用户消息 = 爆发段起点（同 Task 内追问等）。 */
export function isBurstBoundaryUserMessage(message: AgentMessage): boolean {
  if (message.role !== "user") return false;
  const text = localMessageText(message);
  if (text.startsWith("[COMPACTED_MEMORY")) return false;
  if (text.startsWith("Observation from")) return false;
  if (text.includes("Reflection (")) return false;
  if (text.includes("[THREAD_MEMORY]")) return false;
  if (text.includes("Rolling thread memory")) return false;
  return true;
}

function assistantHasToolCalls(message: AgentMessage): boolean {
  return Boolean(message.tool_calls?.length);
}

/** 不把 assistant+tool / assistant+Observation 链从 tail 中间切断。 */
export function alignTailStartToSemanticChains(
  messages: AgentMessage[],
  tailStart: number,
  minStart: number,
): number {
  let start = tailStart;

  while (start > minStart) {
    const current = messages[start];
    if (!current) break;

    if (current.role === "tool") {
      start -= 1;
      const prev = messages[start];
      if (prev?.role === "assistant" && assistantHasToolCalls(prev)) {
        break;
      }
      continue;
    }

    if (isObservationUserMessage(current)) {
      const prev = messages[start - 1];
      if (prev?.role === "assistant") {
        start -= 1;
        continue;
      }
    }

    break;
  }

  return Math.max(minStart, start);
}

/**
 * 在 head 之后计算 tail 起点：默认 maxKeep，若当前爆发段更短则整段保留；并保护语义链。
 */
export function resolveBurstAwareTailStart(
  messages: AgentMessage[],
  headCount: number,
  options: { minKeep: number; maxKeep: number },
): number {
  const minStart = Math.max(0, headCount);
  const total = messages.length;
  if (total <= minStart) return minStart;

  const minKeep = Math.max(1, options.minKeep);
  const maxKeep = Math.max(minKeep, options.maxKeep);
  const available = total - minStart;

  if (available <= minKeep) return minStart;

  const effectiveMaxKeep = Math.min(maxKeep, available);
  let tailStart = total - effectiveMaxKeep;

  let burstStart = -1;
  for (let index = total - 1; index >= minStart; index -= 1) {
    if (isBurstBoundaryUserMessage(messages[index]!)) {
      burstStart = index;
      break;
    }
  }

  if (burstStart >= 0) {
    const burstLen = total - burstStart;
    if (burstLen <= effectiveMaxKeep) {
      tailStart = burstStart;
    }
  }

  const earliestForMinTail = total - Math.min(minKeep, available);
  tailStart = Math.min(tailStart, earliestForMinTail);
  tailStart = alignTailStartToSemanticChains(messages, tailStart, minStart);
  tailStart = Math.max(minStart, Math.min(tailStart, earliestForMinTail));

  return tailStart;
}

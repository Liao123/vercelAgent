import type { AgentMessage } from "@/agent/types";

/**
 * 修复 native tool loop 中 assistant.tool_calls 与 role:tool 顺序被打断的问题。
 * OpenAI 要求：每个 tool 消息必须紧跟在同轮 assistant.tool_calls 之后，中间不能插 user 消息。
 */
export function repairOpenAiAssistantToolPairs(
  messages: AgentMessage[],
): AgentMessage[] {
  const repaired: AgentMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index]!;

    if (message.role !== "assistant" || !message.tool_calls?.length) {
      repaired.push(message);
      index += 1;
      continue;
    }

    repaired.push(message);
    const callIds = message.tool_calls.map((call) => call.id);
    const callIdSet = new Set(callIds);

    let segmentEnd = index + 1;
    while (segmentEnd < messages.length) {
      const next = messages[segmentEnd]!;
      if (next.role === "assistant" && next.tool_calls?.length) {
        break;
      }
      segmentEnd += 1;
    }

    const segment = messages.slice(index + 1, segmentEnd);
    const toolMessages: AgentMessage[] = [];
    const otherMessages: AgentMessage[] = [];

    for (const segmentMessage of segment) {
      if (
        segmentMessage.role === "tool" &&
        segmentMessage.tool_call_id &&
        callIdSet.has(segmentMessage.tool_call_id)
      ) {
        toolMessages.push(segmentMessage);
      } else {
        otherMessages.push(segmentMessage);
      }
    }

    const toolById = new Map(
      toolMessages.map((toolMessage) => [toolMessage.tool_call_id!, toolMessage]),
    );
    for (const callId of callIds) {
      const toolMessage = toolById.get(callId);
      if (toolMessage) {
        repaired.push(toolMessage);
      }
    }

    repaired.push(...otherMessages);
    index = segmentEnd;
  }

  return repaired;
}

import type { AgentEvent, AgentMessage } from "@/agent/types";
import { newId, nowIso } from "@/agent/types";

export type UserGuidanceItem = {
  id: string;
  text: string;
  at: string;
};

const guidanceQueues = new Map<string, UserGuidanceItem[]>();
const activeLoopThreads = new Set<string>();

export class GuidanceNotAcceptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidanceNotAcceptedError";
  }
}

/** Loop 开始时注册 thread，引导 API 仅接受活跃会话。 */
export function beginAgentLoopSession(threadId: string): () => void {
  activeLoopThreads.add(threadId);
  return () => {
    activeLoopThreads.delete(threadId);
    guidanceQueues.delete(threadId);
  };
}

export function isAgentLoopThreadActive(threadId: string): boolean {
  return activeLoopThreads.has(threadId);
}

export function enqueueUserGuidance(
  threadId: string,
  text: string,
): UserGuidanceItem {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new GuidanceNotAcceptedError("引导内容不能为空。");
  }
  const item: UserGuidanceItem = {
    id: newId("guidance"),
    text: trimmed,
    at: nowIso(),
  };
  const queue = guidanceQueues.get(threadId) ?? [];
  queue.push(item);
  guidanceQueues.set(threadId, queue);
  return item;
}

export function submitUserGuidance(
  threadId: string,
  text: string,
): UserGuidanceItem {
  if (!isAgentLoopThreadActive(threadId)) {
    throw new GuidanceNotAcceptedError(
      "当前没有正在运行的任务，无法发送引导。",
    );
  }
  return enqueueUserGuidance(threadId, text);
}

function drainUserGuidance(threadId: string): UserGuidanceItem[] {
  const queue = guidanceQueues.get(threadId) ?? [];
  guidanceQueues.delete(threadId);
  return queue;
}

export function buildUserGuidanceMessage(text: string): string {
  return `[USER_GUIDANCE] 用户在任务运行期间追加了以下引导，请优先理解并按此调整后续行动（这不是新任务，不要重启）：\n\n${text}`;
}

/** 每轮迭代开头 drain 队列，注入 messages 并 emit 事件。 */
export function applyPendingUserGuidance(input: {
  threadId: string;
  taskId: string;
  messages: AgentMessage[];
  emit: (event: AgentEvent) => void;
}): void {
  for (const item of drainUserGuidance(input.threadId)) {
    input.messages.push({
      role: "user",
      content: buildUserGuidanceMessage(item.text),
    });
    input.emit({
      type: "guidance.received",
      taskId: input.taskId,
      threadId: input.threadId,
      id: item.id,
      text: item.text,
      at: item.at,
      applied: true,
    });
  }
}

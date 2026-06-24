/**
 * 主循环耗尽轮次仍未 final 时，强制一轮无工具总结（对齐 Cursor 少「空转无答案」）。
 */
import { getPersistedBrowserPageSnapshot } from "@/agent/browser";
import type { ModelProvider } from "@/agent/model";
import type { AgentMessage } from "@/agent/types";
import type { TaskPlaybookId } from "@/agent/core/task-playbooks";
import type { TaskReasoning } from "@/agent/core/loop-reasoning";
import {
  buildGracefulFinalSnapshotFallback,
  buildGracefulFinalUserTail,
} from "@/agent/core/loop-deliverable";

export const GRACEFUL_FINAL_DEFAULT_SUMMARY =
  "Agent loop stopped without a final answer.";

export function isGracefulFinalPending(summary: string): boolean {
  return summary === GRACEFUL_FINAL_DEFAULT_SUMMARY;
}

export async function attemptGracefulLoopFinal(input: {
  messages: AgentMessage[];
  provider: ModelProvider;
  taskId: string;
  model?: string;
  userRequest: string;
  playbookId?: TaskPlaybookId;
  taskReasoning?: TaskReasoning;
}): Promise<string | null> {
  const tail: AgentMessage = {
    role: "user",
    content: buildGracefulFinalUserTail({
      userRequest: input.userRequest,
      playbookId: input.playbookId,
      taskReasoning: input.taskReasoning,
    }),
  };
  input.messages.push(tail);

  try {
    const output = await input.provider.generate({
      messages: input.messages,
      model: input.model,
      temperature: 0,
      maxTokens: 2400,
      metadata: { taskId: input.taskId, gracefulFinal: true },
    });
    const text = output.content?.trim();
    if (text) return text;
  } catch {
    /* fallback below */
  }

  const snapshot = await getPersistedBrowserPageSnapshot();
  if (snapshot?.textPreview?.trim()) {
    return buildGracefulFinalSnapshotFallback({
      userRequest: input.userRequest,
      playbookId: input.playbookId,
      textPreview: snapshot.textPreview,
    });
  }

  return null;
}

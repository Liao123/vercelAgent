/**
 * 主循环耗尽轮次仍未 final 时，强制一轮无工具总结（对齐 Cursor 少「空转无答案」）。
 */
import { getPersistedBrowserPageSnapshot } from "@/agent/browser";
import type { ModelProvider } from "@/agent/model";
import type { AgentMessage } from "@/agent/types";
import { isBrowserDocAnalysisRequest } from "@/agent/core/task-playbooks";

export const GRACEFUL_FINAL_DEFAULT_SUMMARY =
  "Agent loop stopped without a final answer.";

export function isGracefulFinalPending(summary: string): boolean {
  return summary === GRACEFUL_FINAL_DEFAULT_SUMMARY;
}

export { isBrowserDocAnalysisRequest };

export async function attemptGracefulLoopFinal(input: {
  messages: AgentMessage[];
  provider: ModelProvider;
  taskId: string;
  model?: string;
  userRequest: string;
}): Promise<string | null> {
  const tail: AgentMessage = {
    role: "user",
    content:
      "【系统】主循环已达最大轮次。请仅根据上文工具观测结果，用中文给出完整最终答案（整理接口参数、字段说明等）。不要调用任何工具。若信息不足，明确说明缺什么、用户可如何补充。",
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
    const preview = snapshot.textPreview.trim().slice(0, 4000);
    return `模型未能生成完整总结；以下为浏览器页面文本快照，请据此查看接口参数：\n\n${preview}`;
  }

  return null;
}

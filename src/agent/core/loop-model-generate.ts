/**
 * Loop 模型调用：尽量流式推送 model.delta，减少长时间静默。
 */
import type { AgentEvent } from "@/agent/types";
import type { ModelInput, ModelOutput, ModelProvider } from "@/agent/model/types";

export async function generateLoopModelWithProgress(
  provider: ModelProvider,
  input: ModelInput,
  emit: (event: AgentEvent) => void,
  taskId: string,
): Promise<ModelOutput> {
  const canStream = !input.tools?.length;

  if (canStream) {
    try {
      let content = "";
      for await (const event of provider.stream(input)) {
        if (event.type === "delta" && event.text) {
          content += event.text;
          emit({ type: "model.delta", taskId, text: content });
        }
        if (event.type === "error") {
          throw new Error(event.error);
        }
      }
      return {
        content,
        images: [],
        model: input.model ?? "stream",
      };
    } catch {
      /* 回退非流式 */
    }
  }

  const output = await provider.generate(input);
  const text =
    output.content ||
    (output.toolCalls?.length
      ? `[tools: ${output.toolCalls.map((t) => t.name).join(", ")}]`
      : "");
  if (text) {
    emit({ type: "model.delta", taskId, text });
  }
  return output;
}

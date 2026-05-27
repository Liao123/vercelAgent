/**
 * 模型驱动 Agent Loop API。
 *
 * A028：模型按 JSON 协议选择安全工具，runtime 执行后继续把观察结果喂回模型。
 */
import { runAgentLoop } from "@/agent/core";
import { createAgentEventStream } from "@/agent/protocol/stream";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    userRequest?: string;
    referenceImages?: string[];
    maxIterations?: number;
    model?: string;
    threadId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const userRequest = body.userRequest?.trim() ?? "";

  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.filter(
        (item): item is string =>
          typeof item === "string" && item.startsWith("data:image/"),
      )
    : undefined;

  if (!userRequest && (!referenceImages || referenceImages.length === 0)) {
    return Response.json(
      { error: "userRequest or referenceImages is required." },
      { status: 400 },
    );
  }

  const writer = createAgentEventStream();

  const threadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : undefined;

  void runAgentLoop({
    userRequest: userRequest || "请根据附图完成开发任务。",
    referenceImages:
      referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    maxIterations: body.maxIterations,
    model: body.model,
    threadId,
    onEvent: (event) => writer.emit(event),
  })
    .then(() => {
      writer.close();
    })
    .catch((error) => {
      writer.emit({
        type: "task.failed",
        taskId: "task_unavailable",
        error: error instanceof Error ? error.message : String(error),
      });
      writer.close();
    });

  return writer.response;
}

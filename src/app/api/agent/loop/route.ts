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
    maxIterations?: number;
    model?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const userRequest = body.userRequest?.trim();
  if (!userRequest) {
    return Response.json({ error: "userRequest is required." }, { status: 400 });
  }

  const writer = createAgentEventStream();

  void runAgentLoop({
    userRequest,
    maxIterations: body.maxIterations,
    model: body.model,
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

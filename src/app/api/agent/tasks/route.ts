/**
 * Agent task event stream API.
 *
 * 当前只创建任务并输出事件流骨架。后续 Agent Loop 会在这里串起模型和工具调用。
 */
import { createAgentEventStream } from "@/agent/protocol/stream";
import { startTask } from "@/agent/core";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { userRequest?: string };
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

  void startTask({ userRequest })
    .then((result) => {
      for (const event of result.events) {
        writer.emit(event);
      }
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

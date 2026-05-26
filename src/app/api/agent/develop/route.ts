/**
 * Agent development loop API.
 *
 * 串起需求、文件定位、可选 patch 预览/应用、验证和总结。
 */
import { runDevelopmentLoop } from "@/agent/core";
import { createAgentEventStream } from "@/agent/protocol/stream";
import type { VerificationCommand } from "@/agent/verification";

export const dynamic = "force-dynamic";

function parseVerificationCommands(value: unknown): VerificationCommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(["lint", "build", "test", "typecheck"]);
  const commands = value.filter(
    (item): item is VerificationCommand =>
      typeof item === "string" && allowed.has(item),
  );
  return commands.length > 0 ? commands : undefined;
}

export async function POST(request: Request) {
  let body: {
    userRequest?: string;
    patch?: string;
    applyPatch?: boolean;
    approvalId?: string;
    verify?: boolean;
    verificationCommands?: unknown;
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

  void runDevelopmentLoop({
    userRequest,
    patch: body.patch,
    applyPatch: body.applyPatch,
    approvalId: body.approvalId,
    verify: body.verify,
    verificationCommands: parseVerificationCommands(body.verificationCommands),
  })
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

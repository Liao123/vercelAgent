/**
 * 受控 Shell API：package.json scripts + 任意 workspace 命令（审批后执行）。
 */
import {
  applyShellOperation,
  prepareShellCommand,
  prepareShellRun,
} from "@/agent/tools";
import type { ShellOperation } from "@/agent/types";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

function parseOperation(body: {
  script?: unknown;
  command?: unknown;
}): ShellOperation | null {
  if (typeof body.command === "string" && body.command.trim()) {
    return { type: "raw", command: body.command.trim() };
  }
  if (typeof body.script === "string" && body.script.trim()) {
    return { type: "npm_script", script: body.script.trim() };
  }
  return null;
}

export async function POST(request: Request) {
  let body: {
    mode?: "preview" | "apply";
    taskId?: string;
    script?: unknown;
    command?: unknown;
    approvalId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const operation = parseOperation(body);
  if (!operation) {
    return Response.json(
      { error: "Provide script (npm script name) or command (raw shell)." },
      { status: 400 },
    );
  }

  const taskId = body.taskId?.trim() || "manual_shell";
  const workspace = await getCurrentWorkspace();

  try {
    if (body.mode === "apply") {
      if (!body.approvalId) {
        return Response.json(
          { error: "approvalId is required in apply mode." },
          { status: 400 },
        );
      }
      const result = await applyShellOperation({
        rootPath: workspace.rootPath,
        taskId,
        operation,
        approvalId: body.approvalId,
      });
      return Response.json({ result });
    }

    const result =
      operation.type === "npm_script"
        ? await prepareShellCommand({
            rootPath: workspace.rootPath,
            taskId,
            script: operation.script,
            createApproval: true,
          })
        : await prepareShellRun({
            rootPath: workspace.rootPath,
            taskId,
            command: operation.command,
            createApproval: true,
          });
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Shell command failed.",
      },
      { status: 400 },
    );
  }
}

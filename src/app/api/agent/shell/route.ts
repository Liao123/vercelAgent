/**
 * 受控 Shell API（仅白名单 npm scripts）。
 */
import { applyShellCommand, prepareShellCommand } from "@/agent/tools";
import type { ApprovalShellScript } from "@/agent/types";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

const SCRIPTS = new Set<ApprovalShellScript>([
  "lint",
  "build",
  "test",
  "typecheck",
]);

function parseScript(value: unknown): ApprovalShellScript | null {
  return typeof value === "string" && SCRIPTS.has(value as ApprovalShellScript)
    ? (value as ApprovalShellScript)
    : null;
}

export async function POST(request: Request) {
  let body: {
    mode?: "preview" | "apply";
    taskId?: string;
    script?: unknown;
    approvalId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const script = parseScript(body.script);
  if (!script) {
    return Response.json(
      { error: "script must be one of: lint, build, test, typecheck." },
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
      const result = await applyShellCommand({
        rootPath: workspace.rootPath,
        taskId,
        script,
        approvalId: body.approvalId,
      });
      return Response.json({ result });
    }

    const result = await prepareShellCommand({
      rootPath: workspace.rootPath,
      taskId,
      script,
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

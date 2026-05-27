/**
 * Approval execution API.
 *
 * A035: approval and execution are separate user actions. This endpoint only
 * applies an already approved operation persisted in approval.details.
 */
import {
  recordApprovalExecution,
  requireApprovedApproval,
} from "@/agent/approval";
import {
  applyFileMutation,
  applyGitMutation,
  type AppliedFileMutation,
  type AppliedGitMutation,
} from "@/agent/tools";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

const OUTPUT_LIMIT = 8_000;

function truncateOutput(value: string): string {
  return value.length > OUTPUT_LIMIT
    ? `${value.slice(0, OUTPUT_LIMIT)}\n...[truncated]`
    : value;
}

function filePathSummary(result: AppliedFileMutation): string {
  const preview = result.preview;
  if (result.operation.type === "rename") {
    return `${preview.fromPath ?? result.operation.fromPath} -> ${
      preview.toPath ?? result.operation.toPath
    }`;
  }
  return preview.path ?? result.operation.path;
}

function compactFileResult(result: AppliedFileMutation) {
  return {
    kind: "file_mutation",
    applied: result.applied,
    type: result.preview.type,
    path: result.preview.path,
    fromPath: result.preview.fromPath,
    toPath: result.preview.toPath,
    oldSize: result.preview.oldSize,
    newSize: result.preview.newSize,
  };
}

function compactGitResult(result: AppliedGitMutation) {
  return {
    kind: "git_mutation",
    applied: result.applied,
    command: result.result.command,
    stdout: truncateOutput(result.result.stdout),
    stderr: truncateOutput(result.result.stderr),
  };
}

export async function POST(request: Request) {
  let body: { approvalId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.approvalId) {
    return Response.json({ error: "approvalId is required." }, { status: 400 });
  }

  let approval;
  try {
    approval = requireApprovedApproval(body.approvalId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Approval failed." },
      { status: 400 },
    );
  }

  if (approval.execution?.status === "succeeded") {
    return Response.json(
      { error: "Approval has already been executed.", approval },
      { status: 409 },
    );
  }

  if (!approval.details) {
    return Response.json(
      { error: "Approval has no persisted operation details." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace();

  try {
    if (approval.details.kind === "file_mutation") {
      const result = await applyFileMutation({
        rootPath: workspace.rootPath,
        taskId: approval.taskId,
        operation: approval.details.operation,
        approvalId: approval.id,
      });
      const updatedApproval = recordApprovalExecution(approval.id, {
        status: "succeeded",
        summary: `Applied ${result.preview.type} for ${filePathSummary(result)}.`,
        result: compactFileResult(result),
      });
      return Response.json({ approval: updatedApproval, result });
    }

    const result = await applyGitMutation({
      cwd: workspace.rootPath,
      taskId: approval.taskId,
      operation: approval.details.operation,
      approvalId: approval.id,
    });
    const updatedApproval = recordApprovalExecution(approval.id, {
      status: "succeeded",
      summary: `Executed ${result.result.command}.`,
      result: compactGitResult(result),
    });
    return Response.json({ approval: updatedApproval, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    const updatedApproval = recordApprovalExecution(approval.id, {
      status: "failed",
      summary: "Execution failed.",
      error: message,
    });
    return Response.json(
      { error: message, approval: updatedApproval },
      { status: 400 },
    );
  }
}

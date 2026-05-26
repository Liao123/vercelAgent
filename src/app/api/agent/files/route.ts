/**
 * 受控文件变更 API。
 *
 * preview 会生成 approval；apply 必须携带匹配的已批准 approvalId。
 */
import {
  applyFileMutation,
  prepareFileMutation,
  type FileMutationOperation,
} from "@/agent/tools";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOperation(value: unknown): FileMutationOperation | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (
    value.type === "create" &&
    typeof value.path === "string" &&
    typeof value.content === "string"
  ) {
    return {
      type: "create",
      path: value.path,
      content: value.content,
      overwrite:
        typeof value.overwrite === "boolean" ? value.overwrite : undefined,
    };
  }

  if (
    value.type === "write" &&
    typeof value.path === "string" &&
    typeof value.content === "string"
  ) {
    return {
      type: "write",
      path: value.path,
      content: value.content,
    };
  }

  if (value.type === "delete" && typeof value.path === "string") {
    return {
      type: "delete",
      path: value.path,
    };
  }

  if (
    value.type === "rename" &&
    typeof value.fromPath === "string" &&
    typeof value.toPath === "string"
  ) {
    return {
      type: "rename",
      fromPath: value.fromPath,
      toPath: value.toPath,
      overwrite:
        typeof value.overwrite === "boolean" ? value.overwrite : undefined,
    };
  }

  return null;
}

export async function POST(request: Request) {
  let body: {
    mode?: "preview" | "apply";
    taskId?: string;
    operation?: unknown;
    approvalId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const operation = parseOperation(body.operation);
  if (!operation) {
    return Response.json(
      { error: "operation is invalid or missing." },
      { status: 400 },
    );
  }

  const taskId = body.taskId?.trim() || "manual_file_mutation";
  const workspace = await getCurrentWorkspace();

  try {
    if (body.mode === "apply") {
      if (!body.approvalId) {
        return Response.json(
          { error: "approvalId is required in apply mode." },
          { status: 400 },
        );
      }
      const result = await applyFileMutation({
        rootPath: workspace.rootPath,
        taskId,
        operation,
        approvalId: body.approvalId,
      });
      return Response.json({ result });
    }

    const result = await prepareFileMutation({
      rootPath: workspace.rootPath,
      taskId,
      operation,
      createApproval: true,
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "File mutation failed.",
      },
      { status: 400 },
    );
  }
}

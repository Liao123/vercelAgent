/**
 * 受控 Git 写操作 API。
 *
 * preview 会生成 approval；apply 必须携带匹配的已批准 approvalId。
 */
import {
  applyGitMutation,
  prepareGitMutation,
  type GitMutationOperation,
} from "@/agent/tools";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseGitOperation(value: unknown): GitMutationOperation | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "branch" && typeof value.branchName === "string") {
    return {
      type: "branch",
      branchName: value.branchName,
      checkout: typeof value.checkout === "boolean" ? value.checkout : undefined,
    };
  }

  if (value.type === "commit" && typeof value.message === "string") {
    return {
      type: "commit",
      message: value.message,
      all: typeof value.all === "boolean" ? value.all : undefined,
      paths: Array.isArray(value.paths)
        ? value.paths.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  }

  if (value.type === "push") {
    return {
      type: "push",
      remote: typeof value.remote === "string" ? value.remote : undefined,
      branch: typeof value.branch === "string" ? value.branch : undefined,
      setUpstream:
        typeof value.setUpstream === "boolean" ? value.setUpstream : undefined,
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

  const operation = parseGitOperation(body.operation);
  if (!operation) {
    return Response.json(
      { error: "operation is invalid or missing." },
      { status: 400 },
    );
  }

  const taskId = body.taskId?.trim() || "manual_git_mutation";
  const workspace = await getCurrentWorkspace();

  try {
    if (body.mode === "apply") {
      if (!body.approvalId) {
        return Response.json(
          { error: "approvalId is required in apply mode." },
          { status: 400 },
        );
      }
      const result = await applyGitMutation({
        cwd: workspace.rootPath,
        taskId,
        operation,
        approvalId: body.approvalId,
      });
      return Response.json({ result });
    }

    const result = prepareGitMutation({
      taskId,
      operation,
      createApproval: true,
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Git mutation failed." },
      { status: 400 },
    );
  }
}

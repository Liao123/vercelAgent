/**
 * 受控文件变更工具。
 *
 * A029：补齐创建、删除、重命名、整文件写入能力。所有 apply 操作必须携带
 * 与本次变更内容 hash 匹配的已批准 approval，避免批准 A 却执行 B。
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  contentSnapshot,
  contentSnapshotPair,
} from "@/agent/approval/content-snapshot";
import { createApprovalRequest, requireApprovedApproval } from "@/agent/approval";
import type { ApprovalFileMutationPreview } from "@/agent/types";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";

export type FileMutationMode = "preview" | "apply";

export type FileMutationOperation =
  | {
      type: "create";
      path: string;
      content: string;
      overwrite?: boolean;
    }
  | {
      type: "write";
      path: string;
      content: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "rename";
      fromPath: string;
      toPath: string;
      overwrite?: boolean;
    };

export type PreparedFileMutation = {
  operation: FileMutationOperation;
  operationHash: string;
  requiredApprovalAction: string;
  approval?: ReturnType<typeof createApprovalRequest>;
  preview: FileMutationPreview;
};

export type FileMutationPreview = {
  type: FileMutationOperation["type"];
  path?: string;
  fromPath?: string;
  toPath?: string;
  existsBefore: boolean;
  existsAfter: boolean;
  oldContent?: string;
  newContent?: string;
  oldSize?: number;
  newSize?: number;
};

export type AppliedFileMutation = PreparedFileMutation & {
  applied: boolean;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function getFileMutationApprovalAction(
  operation: FileMutationOperation,
): string {
  const operationHash = createHash("sha256")
    .update(stableStringify(operation))
    .digest("hex");
  return `file.mutate:${operationHash}`;
}

function validateRelativePath(label: string, value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readExistingTextFile(filePath: string): Promise<{
  content: string;
  size: number;
} | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`Target is not a file: ${filePath}`);
    }
    return {
      content: await fs.readFile(filePath, "utf8"),
      size: stat.size,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function normalizeOperation(
  operation: FileMutationOperation,
): FileMutationOperation {
  if (operation.type === "rename") {
    const normalized: FileMutationOperation = {
      type: "rename",
      fromPath: validateRelativePath("fromPath", operation.fromPath),
      toPath: validateRelativePath("toPath", operation.toPath),
    };
    if (typeof operation.overwrite === "boolean") {
      normalized.overwrite = operation.overwrite;
    }
    return normalized;
  }
  if (operation.type === "create") {
    const normalized: FileMutationOperation = {
      type: "create",
      path: validateRelativePath("path", operation.path),
      content: operation.content,
    };
    if (typeof operation.overwrite === "boolean") {
      normalized.overwrite = operation.overwrite;
    }
    return normalized;
  }
  if (operation.type === "write") {
    return {
      type: "write",
      path: validateRelativePath("path", operation.path),
      content: operation.content,
    };
  }
  return {
    type: "delete",
    path: validateRelativePath("path", operation.path),
  };
}

function approvalPreview(preview: FileMutationPreview): ApprovalFileMutationPreview {
  const pair =
    typeof preview.oldContent === "string" &&
    typeof preview.newContent === "string"
      ? contentSnapshotPair(preview.oldContent, preview.newContent)
      : null;

  return {
    type: preview.type,
    path: preview.path,
    fromPath: preview.fromPath,
    toPath: preview.toPath,
    existsBefore: preview.existsBefore,
    existsAfter: preview.existsAfter,
    oldSize: preview.oldSize,
    newSize: preview.newSize,
    sizeDelta:
      typeof preview.oldSize === "number" && typeof preview.newSize === "number"
        ? preview.newSize - preview.oldSize
        : undefined,
    oldContent:
      typeof preview.oldContent === "string"
        ? (pair?.old ?? contentSnapshot(preview.oldContent))
        : undefined,
    newContent:
      typeof preview.newContent === "string"
        ? (pair?.new ?? contentSnapshot(preview.newContent))
        : undefined,
  };
}

function createFileMutationApproval(input: {
  taskId: string;
  title: string;
  reason: string;
  risk: "low" | "medium" | "high";
  action: string;
  operationHash: string;
  operation: FileMutationOperation;
  preview: FileMutationPreview;
}): ReturnType<typeof createApprovalRequest> {
  return createApprovalRequest({
    taskId: input.taskId,
    title: input.title,
    reason: input.reason,
    risk: input.risk,
    action: input.action,
    details: {
      kind: "file_mutation",
      operationHash: input.operationHash,
      operation: input.operation,
      preview: approvalPreview(input.preview),
    },
  });
}

export async function prepareFileMutation(input: {
  rootPath: string;
  taskId: string;
  operation: FileMutationOperation;
  createApproval?: boolean;
}): Promise<PreparedFileMutation> {
  const operation = normalizeOperation(input.operation);
  const requiredApprovalAction = getFileMutationApprovalAction(operation);
  const operationHash = requiredApprovalAction.replace("file.mutate:", "");

  if (operation.type === "rename") {
    const fromAbsolute = resolveInsideWorkspace(input.rootPath, operation.fromPath);
    const toAbsolute = resolveInsideWorkspace(input.rootPath, operation.toPath);
    const fromFile = await readExistingTextFile(fromAbsolute);
    const toFile = await readExistingTextFile(toAbsolute);
    if (!fromFile) {
      throw new Error(`File does not exist: ${operation.fromPath}`);
    }
    if (toFile && !operation.overwrite) {
      throw new Error(`Target already exists: ${operation.toPath}`);
    }
    const preview: FileMutationPreview = {
      type: "rename",
      fromPath: toWorkspaceRelative(input.rootPath, fromAbsolute),
      toPath: toWorkspaceRelative(input.rootPath, toAbsolute),
      existsBefore: true,
      existsAfter: true,
      oldContent: fromFile.content,
      newContent: fromFile.content,
      oldSize: fromFile.size,
      newSize: fromFile.size,
    };

    return {
      operation,
      operationHash,
      requiredApprovalAction,
      approval: input.createApproval
        ? createFileMutationApproval({
            taskId: input.taskId,
            title: "Rename file",
            reason: `Rename ${operation.fromPath} to ${operation.toPath}.`,
            risk: toFile ? "high" : "medium",
            action: requiredApprovalAction,
            operationHash,
            operation,
            preview,
          })
        : undefined,
      preview,
    };
  }

  const absolutePath = resolveInsideWorkspace(input.rootPath, operation.path);
  const existing = await readExistingTextFile(absolutePath);

  if (operation.type === "create") {
    if (existing && !operation.overwrite) {
      throw new Error(`File already exists: ${operation.path}`);
    }
    const preview: FileMutationPreview = {
      type: "create",
      path: toWorkspaceRelative(input.rootPath, absolutePath),
      existsBefore: Boolean(existing),
      existsAfter: true,
      oldContent: existing?.content,
      newContent: operation.content,
      oldSize: existing?.size,
      newSize: Buffer.byteLength(operation.content, "utf8"),
    };
    return {
      operation,
      operationHash,
      requiredApprovalAction,
      approval: input.createApproval
        ? createFileMutationApproval({
            taskId: input.taskId,
            title: existing ? "Overwrite file" : "Create file",
            reason: `${existing ? "Overwrite" : "Create"} ${operation.path}.`,
            risk: existing ? "high" : "medium",
            action: requiredApprovalAction,
            operationHash,
            operation,
            preview,
          })
        : undefined,
      preview,
    };
  }

  if (operation.type === "write") {
    if (!existing) {
      throw new Error(`File does not exist: ${operation.path}`);
    }
    const preview: FileMutationPreview = {
      type: "write",
      path: toWorkspaceRelative(input.rootPath, absolutePath),
      existsBefore: true,
      existsAfter: true,
      oldContent: existing.content,
      newContent: operation.content,
      oldSize: existing.size,
      newSize: Buffer.byteLength(operation.content, "utf8"),
    };
    return {
      operation,
      operationHash,
      requiredApprovalAction,
      approval: input.createApproval
        ? createFileMutationApproval({
            taskId: input.taskId,
            title: "Write file",
            reason: `Replace contents of ${operation.path}.`,
            risk: "medium",
            action: requiredApprovalAction,
            operationHash,
            operation,
            preview,
          })
        : undefined,
      preview,
    };
  }

  if (!existing) {
    throw new Error(`File does not exist: ${operation.path}`);
  }

  const preview: FileMutationPreview = {
    type: "delete",
    path: toWorkspaceRelative(input.rootPath, absolutePath),
    existsBefore: true,
    existsAfter: false,
    oldContent: existing.content,
    oldSize: existing.size,
  };

  return {
    operation,
    operationHash,
    requiredApprovalAction,
    approval: input.createApproval
      ? createFileMutationApproval({
          taskId: input.taskId,
          title: "Delete file",
          reason: `Delete ${operation.path}.`,
          risk: "high",
          action: requiredApprovalAction,
          operationHash,
          operation,
          preview,
        })
      : undefined,
    preview,
  };
}

export async function applyFileMutation(input: {
  rootPath: string;
  taskId: string;
  operation: FileMutationOperation;
  approvalId: string;
}): Promise<AppliedFileMutation> {
  const prepared = await prepareFileMutation({
    rootPath: input.rootPath,
    taskId: input.taskId,
    operation: input.operation,
  });
  const approval = requireApprovedApproval(input.approvalId);
  if (approval.action !== prepared.requiredApprovalAction) {
    throw new Error("Approval does not match this file mutation.");
  }

  const operation = prepared.operation;
  if (operation.type === "rename") {
    const fromAbsolute = resolveInsideWorkspace(input.rootPath, operation.fromPath);
    const toAbsolute = resolveInsideWorkspace(input.rootPath, operation.toPath);
    if ((await fileExists(toAbsolute)) && !operation.overwrite) {
      throw new Error(`Target already exists: ${operation.toPath}`);
    }
    await fs.mkdir(path.dirname(toAbsolute), { recursive: true });
    if (operation.overwrite && (await fileExists(toAbsolute))) {
      await fs.unlink(toAbsolute);
    }
    await fs.rename(fromAbsolute, toAbsolute);
    return { ...prepared, applied: true };
  }

  const absolutePath = resolveInsideWorkspace(input.rootPath, operation.path);
  if (operation.type === "delete") {
    await fs.unlink(absolutePath);
    return { ...prepared, applied: true };
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, operation.content, "utf8");
  return { ...prepared, applied: true };
}

/**
 * 受控 patch 工具。
 *
 * 支持 unified diff：修改、新建、删除、重命名（---/+++ 含 /dev/null）。
 * 真正写入前必须传入已批准的 approval id，路径限制在 workspace 内。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { contentSnapshot } from "@/agent/approval/content-snapshot";
import { createApprovalRequest, requireApprovedApproval } from "@/agent/approval";
import type { ApprovalDetails } from "@/agent/types";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";

export type PatchMode = "preview" | "apply";

export type PatchFileKind = "modify" | "create" | "delete" | "rename";

export type PatchFileChange = {
  kind: PatchFileKind;
  oldPath: string;
  newPath: string;
  oldContent: string;
  newContent: string;
  changed: boolean;
};

export type PatchResult = {
  mode: PatchMode;
  patchHash: string;
  requiredApprovalAction: string;
  files: PatchFileChange[];
  applied: boolean;
};

type ParsedPatchFile = {
  kind: PatchFileKind;
  oldPath: string;
  newPath: string;
  hunks: ParsedHunk[];
};

type ParsedHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

function isDevNullPath(rawPath: string): boolean {
  const trimmed = rawPath.trim().replace(/^[ab]\//, "");
  return trimmed === "/dev/null" || trimmed === "dev/null";
}

function normalizePatchPath(rawPath: string): string {
  const withoutPrefix = rawPath.replace(/^[ab]\//, "").trim();
  if (isDevNullPath(withoutPrefix)) {
    return "";
  }
  const normalized = withoutPrefix.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new Error(`Unsupported patch path: ${rawPath}`);
  }
  return normalized;
}

function inferPatchFileKind(oldPath: string, newPath: string): PatchFileKind {
  if (!oldPath && newPath) return "create";
  if (oldPath && !newPath) return "delete";
  if (oldPath && newPath && oldPath !== newPath) return "rename";
  return "modify";
}

function parseHunkHeader(header: string): ParsedHunk {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) {
    throw new Error(`Invalid hunk header: ${header}`);
  }
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? "1"),
    lines: [],
  };
}

function parseUnifiedDiff(patch: string): ParsedPatchFile[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: ParsedPatchFile[] = [];
  let currentFile: ParsedPatchFile | null = null;
  let currentHunk: ParsedHunk | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("diff --git ")) {
      currentHunk = null;
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldPath = normalizePatchPath(line.slice(4).trim());
      const nextLine = lines[index + 1];
      if (!nextLine?.startsWith("+++ ")) {
        continue;
      }
      const newPath = normalizePatchPath(nextLine.slice(4).trim());
      currentFile = {
        oldPath,
        newPath,
        kind: inferPatchFileKind(oldPath, newPath),
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (line.startsWith("+++ ")) {
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!currentFile) {
        throw new Error("Patch hunk found before file header.");
      }
      currentHunk = parseHunkHeader(line);
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line === "\\ No newline at end of file"
    ) {
      currentHunk.lines.push(line);
    }
  }

  if (files.length === 0) {
    throw new Error("No patch files found.");
  }
  return files;
}

function applyHunksToContent(content: string, hunks: ParsedHunk[]): string {
  const originalLines = content.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let originalIndex = 0;

  for (const hunk of hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    while (originalIndex < hunkStart) {
      result.push(originalLines[originalIndex] ?? "");
      originalIndex += 1;
    }

    for (const line of hunk.lines) {
      if (line === "\\ No newline at end of file") continue;
      const marker = line[0];
      const value = line.slice(1);

      if (marker === " ") {
        if (originalIndex < originalLines.length && originalLines[originalIndex] !== value) {
          throw new Error(
            `Patch context mismatch at original line ${originalIndex + 1}.`,
          );
        }
        result.push(value);
        originalIndex += 1;
      } else if (marker === "-") {
        if (originalIndex < originalLines.length && originalLines[originalIndex] !== value) {
          throw new Error(
            `Patch removal mismatch at original line ${originalIndex + 1}.`,
          );
        }
        originalIndex += 1;
      } else if (marker === "+") {
        result.push(value);
      } else {
        throw new Error(`Unsupported patch line: ${line}`);
      }
    }
  }

  while (originalIndex < originalLines.length) {
    result.push(originalLines[originalIndex]);
    originalIndex += 1;
  }

  return result.join("\n");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolvePatchChange(
  rootPath: string,
  parsedFile: ParsedPatchFile,
): Promise<PatchFileChange> {
  const { kind, hunks } = parsedFile;

  if (kind === "create") {
    if (!parsedFile.newPath) {
      throw new Error("Create patch is missing target path.");
    }
    const absolutePath = resolveInsideWorkspace(rootPath, parsedFile.newPath);
    if (await fileExists(absolutePath)) {
      throw new Error(`File already exists: ${parsedFile.newPath}`);
    }
    const newContent = applyHunksToContent("", hunks);
    return {
      kind: "create",
      oldPath: "",
      newPath: toWorkspaceRelative(rootPath, absolutePath),
      oldContent: "",
      newContent,
      changed: true,
    };
  }

  if (kind === "delete") {
    if (!parsedFile.oldPath) {
      throw new Error("Delete patch is missing source path.");
    }
    const absolutePath = resolveInsideWorkspace(rootPath, parsedFile.oldPath);
    if (!(await fileExists(absolutePath))) {
      throw new Error(`File does not exist: ${parsedFile.oldPath}`);
    }
    const oldContent = await fs.readFile(absolutePath, "utf8");
    const newContent = applyHunksToContent(oldContent, hunks);
    return {
      kind: "delete",
      oldPath: toWorkspaceRelative(rootPath, absolutePath),
      newPath: "",
      oldContent,
      newContent,
      changed: true,
    };
  }

  if (kind === "rename") {
    if (!parsedFile.oldPath || !parsedFile.newPath) {
      throw new Error("Rename patch is missing paths.");
    }
    const fromAbsolute = resolveInsideWorkspace(rootPath, parsedFile.oldPath);
    const toAbsolute = resolveInsideWorkspace(rootPath, parsedFile.newPath);
    if (!(await fileExists(fromAbsolute))) {
      throw new Error(`File does not exist: ${parsedFile.oldPath}`);
    }
    const oldContent = await fs.readFile(fromAbsolute, "utf8");
    const newContent = applyHunksToContent(oldContent, hunks);
    return {
      kind: "rename",
      oldPath: toWorkspaceRelative(rootPath, fromAbsolute),
      newPath: toWorkspaceRelative(rootPath, toAbsolute),
      oldContent,
      newContent,
      changed: parsedFile.oldPath !== parsedFile.newPath || oldContent !== newContent,
    };
  }

  if (!parsedFile.newPath) {
    throw new Error("Modify patch is missing target path.");
  }
  const absolutePath = resolveInsideWorkspace(rootPath, parsedFile.newPath);
  if (!(await fileExists(absolutePath))) {
    throw new Error(`File does not exist: ${parsedFile.newPath}`);
  }
  const oldContent = await fs.readFile(absolutePath, "utf8");
  const newContent = applyHunksToContent(oldContent, hunks);
  return {
    kind: "modify",
    oldPath: toWorkspaceRelative(rootPath, absolutePath),
    newPath: toWorkspaceRelative(rootPath, absolutePath),
    oldContent,
    newContent,
    changed: oldContent !== newContent,
  };
}

async function applyPatchChange(
  rootPath: string,
  change: PatchFileChange,
): Promise<void> {
  if (change.kind === "create") {
    const absolutePath = resolveInsideWorkspace(rootPath, change.newPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, change.newContent, "utf8");
    return;
  }

  if (change.kind === "delete") {
    const absolutePath = resolveInsideWorkspace(rootPath, change.oldPath);
    await fs.unlink(absolutePath);
    return;
  }

  if (change.kind === "rename") {
    const fromAbsolute = resolveInsideWorkspace(rootPath, change.oldPath);
    const toAbsolute = resolveInsideWorkspace(rootPath, change.newPath);
    await fs.mkdir(path.dirname(toAbsolute), { recursive: true });
    await fs.writeFile(toAbsolute, change.newContent, "utf8");
    if (fromAbsolute !== toAbsolute) {
      await fs.unlink(fromAbsolute);
    }
    return;
  }

  const absolutePath = resolveInsideWorkspace(rootPath, change.newPath);
  await fs.writeFile(absolutePath, change.newContent, "utf8");
}

export function getPatchApprovalAction(patch: string): string {
  const patchHash = createHash("sha256").update(patch).digest("hex");
  return `patch.apply:${patchHash}`;
}

export function buildPatchApprovalDetails(
  patch: string,
  result: PatchResult,
): ApprovalDetails {
  const operationHash = result.requiredApprovalAction.replace("patch.apply:", "");
  const changedCount = result.files.filter((file) => file.changed).length;
  return {
    kind: "patch_apply",
    operationHash,
    patch,
    preview: {
      fileCount: result.files.length,
      changedCount,
      patchPreview: contentSnapshot(patch),
      files: result.files.map((file) => ({
        filePath: file.newPath || file.oldPath,
        oldPath: file.oldPath || undefined,
        newPath: file.newPath || undefined,
        kind: file.kind,
        changed: file.changed,
        oldContent: contentSnapshot(file.oldContent),
        newContent: contentSnapshot(file.newContent),
      })),
    },
  };
}

export function createPatchApproval(input: {
  taskId: string;
  patch: string;
  result: PatchResult;
}): ReturnType<typeof createApprovalRequest> {
  const hasDelete = input.result.files.some((file) => file.kind === "delete");
  return createApprovalRequest({
    taskId: input.taskId,
    title: "Apply patch",
    reason: `Apply unified diff to ${input.result.files.length} file(s).`,
    risk: hasDelete ? "high" : "medium",
    action: input.result.requiredApprovalAction,
    details: buildPatchApprovalDetails(input.patch, input.result),
  });
}

export async function applyUnifiedPatch(input: {
  rootPath: string;
  patch: string;
  mode: PatchMode;
  approvalId?: string;
}): Promise<PatchResult> {
  const requiredApprovalAction = getPatchApprovalAction(input.patch);

  if (input.mode === "apply") {
    if (!input.approvalId) {
      throw new Error("approvalId is required to apply a patch.");
    }
    const approval = requireApprovedApproval(input.approvalId);
    if (approval.action !== requiredApprovalAction) {
      throw new Error("Approval does not match this patch.");
    }
  }

  const parsedFiles = parseUnifiedDiff(input.patch);
  const changes: PatchFileChange[] = [];

  for (const parsedFile of parsedFiles) {
    changes.push(await resolvePatchChange(input.rootPath, parsedFile));
  }

  if (input.mode === "apply") {
    for (const change of changes) {
      if (!change.changed && change.kind === "modify") continue;
      await applyPatchChange(input.rootPath, change);
    }
  }

  return {
    mode: input.mode,
    patchHash: requiredApprovalAction.replace("patch.apply:", ""),
    requiredApprovalAction,
    files: changes,
    applied: input.mode === "apply",
  };
}

export function describePatchFiles(result: PatchResult): string[] {
  return result.files.map((file) => {
    const target = file.newPath || file.oldPath;
    if (file.kind === "rename") {
      return `${file.oldPath} -> ${file.newPath}`;
    }
    return path.posix.normalize(target);
  });
}

/**
 * 受控 patch 工具。
 *
 * 当前支持标准 unified diff 的最小子集：修改已存在文件的连续 hunk。
 * 真正写入文件前必须传入已批准的 approval id，并且所有路径都必须在 workspace 内。
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { requireApprovedApproval } from "@/agent/approval";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";

export type PatchMode = "preview" | "apply";

export type PatchFileChange = {
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

function normalizePatchPath(rawPath: string): string {
  const withoutPrefix = rawPath.replace(/^[ab]\//, "");
  if (!withoutPrefix || withoutPrefix === "/dev/null") {
    throw new Error(`Unsupported patch path: ${rawPath}`);
  }
  return withoutPrefix.replaceAll("\\", "/");
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
      currentFile = {
        oldPath,
        newPath: normalizePatchPath(nextLine.slice(4).trim()),
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
    const hunkStart = hunk.oldStart - 1;
    while (originalIndex < hunkStart) {
      result.push(originalLines[originalIndex]);
      originalIndex += 1;
    }

    for (const line of hunk.lines) {
      if (line === "\\ No newline at end of file") continue;
      const marker = line[0];
      const value = line.slice(1);

      if (marker === " ") {
        if (originalLines[originalIndex] !== value) {
          throw new Error(
            `Patch context mismatch at original line ${originalIndex + 1}.`,
          );
        }
        result.push(value);
        originalIndex += 1;
      } else if (marker === "-") {
        if (originalLines[originalIndex] !== value) {
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

export function getPatchApprovalAction(patch: string): string {
  const patchHash = createHash("sha256").update(patch).digest("hex");
  return `patch.apply:${patchHash}`;
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
    if (parsedFile.oldPath !== parsedFile.newPath) {
      throw new Error("File rename patches are not supported yet.");
    }

    const absolutePath = resolveInsideWorkspace(input.rootPath, parsedFile.newPath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Patch target is not a file: ${parsedFile.newPath}`);
    }

    const oldContent = await fs.readFile(absolutePath, "utf8");
    const newContent = applyHunksToContent(oldContent, parsedFile.hunks);
    changes.push({
      oldPath: toWorkspaceRelative(input.rootPath, absolutePath),
      newPath: toWorkspaceRelative(input.rootPath, absolutePath),
      oldContent,
      newContent,
      changed: oldContent !== newContent,
    });
  }

  if (input.mode === "apply") {
    for (const change of changes) {
      const absolutePath = resolveInsideWorkspace(input.rootPath, change.newPath);
      await fs.writeFile(absolutePath, change.newContent, "utf8");
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
  return result.files.map((file) =>
    path.posix.normalize(file.newPath || file.oldPath),
  );
}

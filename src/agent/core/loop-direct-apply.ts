/**
 * A112：Agent Loop 内直接写盘后的统一后处理（file.changed + lint 验证）。
 */
import {
  changedPathsFromFileMutation,
  changedPathsFromPatch,
  clearStoredPostExecuteVerification,
  persistPostExecuteVerification,
  postExecuteFeedbackFromStored,
  runPostExecuteVerification,
  type PostExecuteVerification,
} from "@/agent/verification/post-execute-verify";
import type { AgentEvent } from "@/agent/types";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import { isEditTaskSatisfied } from "@/agent/core/agent-loop-state";
import { recordFilesWritten } from "@/agent/core/loop-deliverable";
import type { AppliedFileMutation } from "@/agent/tools/file-mutations";
import type { PatchResult } from "@/agent/tools/patch-tools";
import { emitKernelBootstrapValidateFlow } from "@/agent/core/kernel-bootstrap-validate";
import {
  buildReplicateAfterWriteNudge,
} from "@/agent/core/loop-replicate-nudge";
import { computeLineDiff } from "@/lib/line-diff";

export const DIRECT_MUTATION_TOOL_NAMES = new Set([
  "file.replace",
  "file.mutation",
  "patch.apply",
]);

export function isDirectMutationToolName(toolName: string): boolean {
  return DIRECT_MUTATION_TOOL_NAMES.has(toolName);
}

export { isEditTaskSatisfied };

export function changedPathsFromDirectFileResult(
  result: AppliedFileMutation,
): string[] {
  return changedPathsFromFileMutation({
    type: result.preview.type,
    path: result.preview.path,
    fromPath: result.preview.fromPath,
    toPath: result.preview.toPath,
  });
}

export function fileDiffSnippetFromPreview(
  preview: AppliedFileMutation["preview"],
): string {
  if (preview.oldContent != null && preview.newContent != null) {
    return `--- ${preview.path ?? preview.fromPath ?? "file"}\n+++ ${preview.path ?? preview.toPath ?? "file"}\n(old ${preview.oldSize ?? 0} bytes → new ${preview.newSize ?? 0} bytes)`;
  }
  return `Applied ${preview.type} to ${preview.path ?? preview.toPath ?? preview.fromPath ?? "file"}`;
}

function unifiedDiffLineCount(text: string): number {
  if (!text) return 0;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines.length;
}

function appendTurnDiff(previous: string | undefined, next: string): string {
  const parts = [previous?.trimEnd(), next.trimEnd()].filter(Boolean);
  return parts.join("\n");
}

export function unifiedDiffFromContents(input: {
  filePath: string;
  oldContent?: string;
  newContent?: string;
}): string {
  const before = input.oldContent ?? "";
  const after = input.newContent ?? "";
  const rows = computeLineDiff(before, after);
  const oldPath = before ? `a/${input.filePath}` : "/dev/null";
  const newPath = after ? `b/${input.filePath}` : "/dev/null";
  const body = rows.map((row) => {
    if (row.kind === "equal") return ` ${row.line}`;
    if (row.kind === "delete") return `-${row.line}`;
    return `+${row.line}`;
  });

  return [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${unifiedDiffLineCount(before)} +1,${unifiedDiffLineCount(after)} @@`,
    ...body,
  ].join("\n");
}

export async function attachLoopPostExecuteVerification(input: {
  rootPath: string;
  taskId: string;
  sourceId: string;
  changedPaths: string[];
}): Promise<PostExecuteVerification> {
  const verification = await runPostExecuteVerification(
    input.rootPath,
    input.changedPaths,
  );
  if (verification.triggered) {
    if (verification.success) {
      await clearStoredPostExecuteVerification(input.rootPath);
    } else {
      await persistPostExecuteVerification(input.rootPath, {
        taskId: input.taskId,
        approvalId: input.sourceId,
        verification,
      });
    }
  }
  return verification;
}

export async function emitDirectApplySideEffects(input: {
  taskId: string;
  toolName: string;
  rootPath: string;
  emit: (event: AgentEvent) => void;
  runState: AgentLoopRunState;
  fileResult?: AppliedFileMutation;
  patchResult?: PatchResult;
  patchText?: string;
}): Promise<string | null> {
  const changedPaths: string[] = [];
  const fileEvents: Array<{
    path: string;
    diff: string;
    oldContent?: string;
    newContent?: string;
  }> = [];

  if (input.fileResult) {
    const paths = changedPathsFromDirectFileResult(input.fileResult);
    changedPaths.push(...paths);
    const oldContent = input.fileResult.preview.oldContent ?? "";
    const newContent = input.fileResult.preview.newContent ?? "";
    for (const filePath of paths) {
      fileEvents.push({
        path: filePath,
        oldContent,
        newContent,
        diff: unifiedDiffFromContents({
          filePath,
          oldContent,
          newContent,
        }),
      });
    }
  }

  if (input.patchResult) {
    const paths = changedPathsFromPatch(input.patchResult.files);
    changedPaths.push(...paths);
    const diff = input.patchText ?? "patch.apply";
    for (const file of input.patchResult.files) {
      if (!file.changed) continue;
      const filePath = file.newPath || file.oldPath;
      if (filePath && filePath !== "/dev/null") {
        fileEvents.push({
          path: filePath,
          oldContent: file.oldContent,
          newContent: file.newContent,
          diff: unifiedDiffFromContents({
            filePath,
            oldContent: file.oldContent,
            newContent: file.newContent,
          }) || diff,
        });
      }
    }
  }

  input.runState.editApplied = true;
  input.runState.approvalPrepared = true;
  recordFilesWritten(input.runState, changedPaths);
  if (input.runState.postExecuteFeedback) {
    delete input.runState.postExecuteFeedback;
  }

  for (const file of fileEvents) {
    input.runState.turnDiff = appendTurnDiff(input.runState.turnDiff, file.diff);
    input.emit({
      type: "turn.diff.updated",
      taskId: input.taskId,
      filePath: file.path,
      diff: input.runState.turnDiff,
      at: new Date().toISOString(),
    });
    input.emit({
      type: "file.changed",
      taskId: input.taskId,
      filePath: file.path,
      diff: file.diff,
      oldContent: file.oldContent,
      newContent: file.newContent,
    });
  }

  if (changedPaths.length === 0) return null;

  const verification = await attachLoopPostExecuteVerification({
    rootPath: input.rootPath,
    taskId: input.taskId,
    sourceId: `direct:${input.toolName}`,
    changedPaths,
  });

  if (verification.triggered) {
    input.emit({
      type: "verification.completed",
      taskId: input.taskId,
      result: verification.results[0] ?? {
        command: "post-execute",
        success: verification.success,
        output: verification.summary,
        completedAt: verification.completedAt,
      },
    });
    if (!verification.success) {
      const feedback = postExecuteFeedbackFromStored({
        taskId: input.taskId,
        approvalId: `direct:${input.toolName}`,
        verification,
        savedAt: verification.completedAt,
      });
      if (feedback) {
        input.runState.postExecuteFeedback = feedback;
      }
    }
  }

  const bootstrapHint = await emitKernelBootstrapValidateFlow({
    taskId: input.taskId,
    rootPath: input.rootPath,
    changedPaths,
    emit: input.emit,
  });
  const replicateHint = buildReplicateAfterWriteNudge(
    input.runState,
    changedPaths,
    input.rootPath,
  );
  const hints = [bootstrapHint, replicateHint].filter(Boolean);
  return hints.length > 0 ? hints.join("\n\n") : null;
}

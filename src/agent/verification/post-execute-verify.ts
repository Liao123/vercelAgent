/**
 * 文件审批执行后的自动 lint/typecheck 回灌（A079）。
 * 仅白名单 npm scripts；失败不自动修复，只回传结果。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, type VerificationResult } from "@/agent/types";
import {
  getVerificationPlan,
  runScopedLintCommand,
  runVerificationCommand,
  type VerificationCommand,
} from "@/agent/verification";

const POST_EXECUTE_SCRIPTS: VerificationCommand[] = ["lint"];
const CODE_FILE_PATTERN = /\.(tsx?|jsx?|css|json|mjs|cjs)$/i;

export type PostExecuteVerification = {
  triggered: boolean;
  skippedReason?: string;
  changedPaths: string[];
  results: VerificationResult[];
  success: boolean;
  summary: string;
  completedAt: string;
};

export function shouldRunPostExecuteVerification(
  changedPaths: string[],
): boolean {
  if (process.env.AGENT_POST_EXECUTE_VERIFY === "0") return false;
  return changedPaths.some((filePath) =>
    CODE_FILE_PATTERN.test(filePath.replaceAll("\\", "/")),
  );
}

function truncateOutput(value: string, limit = 6000): string {
  return value.length > limit
    ? `${value.slice(0, limit)}\n...[truncated]`
    : value;
}

export async function runPostExecuteVerification(
  rootPath: string,
  changedPaths: string[],
): Promise<PostExecuteVerification> {
  const normalizedPaths = changedPaths.map((p) => p.replaceAll("\\", "/"));
  const completedAt = nowIso();

  if (!shouldRunPostExecuteVerification(normalizedPaths)) {
    return {
      triggered: false,
      skippedReason: "No code-like files changed or post-execute verify disabled.",
      changedPaths: normalizedPaths,
      results: [],
      success: true,
      summary: "未触发执行后验证（无 ts/tsx/js 等变更）。",
      completedAt,
    };
  }

  const plan = await getVerificationPlan(rootPath, POST_EXECUTE_SCRIPTS);
  if (plan.available.length === 0) {
    return {
      triggered: false,
      skippedReason: "No lint/typecheck scripts in package.json.",
      changedPaths: normalizedPaths,
      results: [],
      success: true,
      summary: "package.json 无 lint/typecheck/build，跳过执行后验证。",
      completedAt,
    };
  }

  const results: VerificationResult[] = [];
  for (const command of plan.available) {
    const result =
      command === "lint"
        ? await runScopedLintCommand(rootPath, normalizedPaths)
        : await runVerificationCommand(rootPath, command);
    results.push({
      ...result,
      output: truncateOutput(result.output),
    });
    if (!result.success) break;
  }

  const success = results.every((item) => item.success);
  const failed = results.find((item) => !item.success);
  const summary = success
    ? `执行后验证通过：${results.map((r) => r.command).join(" → ")}。`
    : `执行后验证失败：${failed?.command ?? "unknown"}。Agent 应读取错误输出并 file.replace.prepare 修复。`;

  return {
    triggered: true,
    changedPaths: normalizedPaths,
    results,
    success,
    summary,
    completedAt,
  };
}

export async function persistPostExecuteVerification(
  rootPath: string,
  input: {
    taskId: string;
    approvalId: string;
    verification: PostExecuteVerification;
  },
): Promise<void> {
  const stateDir = path.join(rootPath, ".agent-state");
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, "post-execute-verify.json");
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        taskId: input.taskId,
        approvalId: input.approvalId,
        verification: input.verification,
        savedAt: nowIso(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function changedPathsFromFileMutation(input: {
  type: string;
  path?: string;
  fromPath?: string;
  toPath?: string;
}): string[] {
  const paths = new Set<string>();
  if (input.path) paths.add(input.path);
  if (input.fromPath) paths.add(input.fromPath);
  if (input.toPath) paths.add(input.toPath);
  return [...paths];
}

export type StoredPostExecuteVerification = {
  taskId: string;
  approvalId: string;
  verification: PostExecuteVerification;
  savedAt: string;
};

/** 上一轮审批执行后写入的验证结果（供下一轮 Loop 读取）。 */
export async function clearStoredPostExecuteVerification(
  rootPath: string,
): Promise<void> {
  const filePath = path.join(rootPath, ".agent-state", "post-execute-verify.json");
  try {
    await fs.unlink(filePath);
  } catch {
    // missing file is fine
  }
}

export async function loadStoredPostExecuteVerification(
  rootPath: string,
): Promise<StoredPostExecuteVerification | null> {
  const filePath = path.join(rootPath, ".agent-state", "post-execute-verify.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoredPostExecuteVerification;
    if (!parsed?.verification || typeof parsed.taskId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type PostExecuteFeedback = {
  summary: string;
  failedCommand?: string;
  outputSnippet?: string;
  changedPaths: string[];
  approvalId?: string;
  taskId?: string;
};

export function postExecuteFeedbackFromStored(
  stored: StoredPostExecuteVerification,
): PostExecuteFeedback | null {
  const verification = stored.verification;
  if (!verification.triggered || verification.success) return null;

  const failed = verification.results.find((item) => !item.success);
  return {
    summary: verification.summary,
    failedCommand: failed?.command,
    outputSnippet: failed?.output?.slice(0, 2_000),
    changedPaths: verification.changedPaths,
    approvalId: stored.approvalId,
    taskId: stored.taskId,
  };
}

export function formatPostExecuteFeedbackBlock(
  feedback: PostExecuteFeedback,
): string {
  const lines = [
    "=== Post-execute verification failed (fix in this task) ===",
    feedback.summary,
    `Changed files: ${feedback.changedPaths.join(", ") || "(unknown)"}`,
  ];
  if (feedback.failedCommand) {
    lines.push(`Failed command: ${feedback.failedCommand}`);
  }
  if (feedback.outputSnippet?.trim()) {
    lines.push("stderr/stdout excerpt:", feedback.outputSnippet.trim());
  }
  lines.push(
    "Read the errors above, fix source with file.replace, or run workspace.inspect for full JSON.",
    "Do not action=final until lint/typecheck would pass or user accepts the failure.",
  );
  return lines.join("\n");
}

export function changedPathsFromPatch(
  files: Array<{ changed: boolean; oldPath: string; newPath: string }>,
): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    if (!file.changed) continue;
    if (file.newPath && file.newPath !== "/dev/null") paths.add(file.newPath);
    if (file.oldPath && file.oldPath !== "/dev/null") paths.add(file.oldPath);
  }
  return [...paths];
}

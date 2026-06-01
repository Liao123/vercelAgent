/**
 * 文件审批执行后的自动 lint/typecheck 回灌（A079）。
 * 仅白名单 npm scripts；失败不自动修复，只回传结果。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, type VerificationResult } from "@/agent/types";
import {
  getVerificationPlan,
  runVerificationCommand,
  type VerificationCommand,
} from "@/agent/verification";

const POST_EXECUTE_SCRIPTS: VerificationCommand[] = ["lint", "typecheck"];
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
      summary: "package.json 无 lint/typecheck，跳过执行后验证。",
      completedAt,
    };
  }

  const results: VerificationResult[] = [];
  for (const command of plan.available) {
    const result = await runVerificationCommand(rootPath, command);
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
    : `执行后验证失败：${failed?.command ?? "unknown"}。请在下一轮 Loop 中修复 stderr 后重新 prepare（不会自动改代码）。`;

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

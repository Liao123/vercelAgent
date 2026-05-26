/**
 * Verification Runner。
 *
 * 只运行 package.json 中已有的白名单 npm scripts，不开放任意 shell。
 * 这会成为后续开发闭环里的 lint/build/test 验证工具。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { VerificationResult } from "@/agent/types";
import { nowIso } from "@/agent/types";

const execFileAsync = promisify(execFile);

export type VerificationCommand = "lint" | "build" | "test" | "typecheck";

export type VerificationPlan = {
  available: VerificationCommand[];
  missing: VerificationCommand[];
};

const DEFAULT_COMMANDS: VerificationCommand[] = [
  "lint",
  "typecheck",
  "test",
  "build",
];

async function readPackageScripts(
  rootPath: string,
): Promise<Record<string, string>> {
  const raw = await fs.readFile(path.join(rootPath, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

export async function getVerificationPlan(
  rootPath: string,
  requested: VerificationCommand[] = DEFAULT_COMMANDS,
): Promise<VerificationPlan> {
  const scripts = await readPackageScripts(rootPath);
  const available = requested.filter((command) => command in scripts);
  const missing = requested.filter((command) => !(command in scripts));
  return { available, missing };
}

export async function runVerificationCommand(
  rootPath: string,
  command: VerificationCommand,
): Promise<VerificationResult> {
  const plan = await getVerificationPlan(rootPath, [command]);
  if (!plan.available.includes(command)) {
    return {
      command: `npm run ${command}`,
      success: false,
      output: `Missing npm script: ${command}`,
      completedAt: nowIso(),
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync("npm", ["run", command], {
      cwd: rootPath,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
    return {
      command: `npm run ${command}`,
      success: true,
      output: [stdout, stderr].filter(Boolean).join("\n"),
      completedAt: nowIso(),
    };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      command: `npm run ${command}`,
      success: false,
      output: [execError.stdout, execError.stderr, execError.message]
        .filter(Boolean)
        .join("\n"),
      completedAt: nowIso(),
    };
  }
}

export async function runVerificationPlan(
  rootPath: string,
  requested: VerificationCommand[] = DEFAULT_COMMANDS,
): Promise<{
  plan: VerificationPlan;
  results: VerificationResult[];
  success: boolean;
}> {
  const plan = await getVerificationPlan(rootPath, requested);
  const results: VerificationResult[] = [];

  for (const command of plan.available) {
    const result = await runVerificationCommand(rootPath, command);
    results.push(result);
    if (!result.success) break;
  }

  return {
    plan,
    results,
    success: results.every((result) => result.success),
  };
}

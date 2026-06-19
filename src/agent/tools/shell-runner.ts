/**
 * 在 workspace 内执行已审批的 shell 命令。
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { VerificationResult } from "@/agent/types";
import { nowIso } from "@/agent/types";
import {
  normalizeShellCommand,
  validateShellCommand,
} from "@/agent/tools/shell-command-policy";
import {
  appendPortBusyHint,
  decodeChunk,
  formatShellOutputForDisplay,
  isLongRunningNpmScript,
  looksLikeDevServerReady,
  parseNpmRunCommand,
  sanitizeShellCommand,
} from "@/agent/tools/shell-output";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const LONG_RUNNING_READY_MS = 20_000;
const MAX_BUFFER = 10 * 1024 * 1024;

async function runNpmScript(
  rootPath: string,
  script: string,
  passThroughArgs: string[] = [],
): Promise<{ stdout: Buffer | string; stderr: Buffer | string }> {
  const args = ["run", script, ...passThroughArgs];
  return execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    args,
    {
      cwd: rootPath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      timeout: DEFAULT_TIMEOUT_MS,
      shell: process.platform === "win32",
      encoding: "buffer",
    },
  ) as Promise<{ stdout: Buffer; stderr: Buffer }>;
}

async function runLongRunningNpmScript(
  rootPath: string,
  script: string,
  passThroughArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const args = ["run", script, ...passThroughArgs];
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child: ChildProcess | null = null;

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (success && child && child.exitCode === null) {
        child.unref();
      }
      const formatted = formatShellOutputForDisplay(output);
      resolve({
        stdout: success
          ? `${formatted}\n\n（开发服务已在后台运行，输出不再阻塞 Agent。）`
          : appendPortBusyHint(formatted),
        stderr: "",
        success,
      });
    };

    child = spawn(npmBin, args, {
      cwd: rootPath,
      shell: process.platform === "win32",
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const append = (chunk: Buffer) => {
      output += decodeChunk(chunk);
      if (looksLikeDevServerReady(output)) {
        finish(true);
      }
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    child.on("error", (error) => {
      output += error.message;
      finish(false);
    });

    child.on("exit", (code) => {
      if (settled) return;
      if (code === 0 || looksLikeDevServerReady(output)) {
        finish(true);
        return;
      }
      finish(false);
    });

    const timer = setTimeout(() => {
      if (looksLikeDevServerReady(output)) {
        finish(true);
        return;
      }
      finish(false);
    }, LONG_RUNNING_READY_MS);
  });
}

async function runRawShell(
  rootPath: string,
  command: string,
): Promise<{ stdout: Buffer | string; stderr: Buffer | string }> {
  const wrapped =
    process.platform === "win32"
      ? `chcp 65001>nul & ${command}`
      : command;
  return execFileAsync(
    process.platform === "win32" ? "cmd.exe" : "sh",
    process.platform === "win32" ? ["/d", "/s", "/c", wrapped] : ["-lc", wrapped],
    {
      cwd: rootPath,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      timeout: DEFAULT_TIMEOUT_MS,
      encoding: "buffer",
    },
  ) as Promise<{ stdout: Buffer; stderr: Buffer }>;
}

export async function executeShellCommand(
  rootPath: string,
  command: string,
): Promise<VerificationResult> {
  const sanitized = sanitizeShellCommand(normalizeShellCommand(command));
  const validation = validateShellCommand(sanitized);
  if (!validation.allowed) {
    return {
      command: sanitized,
      success: false,
      output: validation.reason ?? "Command blocked by policy.",
      completedAt: nowIso(),
    };
  }

  const npmRun = parseNpmRunCommand(sanitized);
  const displayCommand = npmRun
    ? `npm run ${npmRun.script}${npmRun.passThroughArgs.length ? ` -- ${npmRun.passThroughArgs.join(" ")}` : ""}`
    : sanitized;

  try {
    if (npmRun && isLongRunningNpmScript(npmRun.script)) {
      const longRun = await runLongRunningNpmScript(
        rootPath,
        npmRun.script,
        npmRun.passThroughArgs.length
          ? ["--", ...npmRun.passThroughArgs]
          : [],
      );
      return {
        command: displayCommand,
        success: longRun.success,
        output: longRun.stdout || longRun.stderr,
        completedAt: nowIso(),
      };
    }

    const { stdout, stderr } = npmRun
      ? await runNpmScript(
          rootPath,
          npmRun.script,
          npmRun.passThroughArgs.length
            ? ["--", ...npmRun.passThroughArgs]
            : [],
        )
      : await runRawShell(rootPath, sanitized);

    return {
      command: displayCommand,
      success: true,
      output: formatShellOutputForDisplay(
        [decodeChunk(stdout as Buffer), decodeChunk(stderr as Buffer)]
          .filter(Boolean)
          .join("\n"),
      ),
      completedAt: nowIso(),
    };
  } catch (error) {
    const execError = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message?: string;
      killed?: boolean;
    };
    const output = formatShellOutputForDisplay(
      [decodeChunk(execError.stdout), decodeChunk(execError.stderr)]
        .filter(Boolean)
        .join("\n"),
    );
    const decodedMessage =
      execError.killed && !output
        ? "Command timed out."
        : appendPortBusyHint(output) ||
          execError.message ||
          `Command failed: ${displayCommand}`;
    return {
      command: displayCommand,
      success: false,
      output: decodedMessage,
      completedAt: nowIso(),
    };
  }
}

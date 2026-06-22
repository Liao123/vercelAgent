/**
 * 在 workspace 内执行已审批的 shell 命令。
 * Windows：对齐 Cursor，后台静默 spawn（不用 detached，避免弹 CMD 窗）。
 */
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
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
  looksLikeDevAlreadyRunning,
  looksLikeDevServerReady,
  looksLikeDevServerTerminalFailure,
  parseNpmRunCommand,
  sanitizeShellCommand,
} from "@/agent/tools/shell-output";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const LONG_RUNNING_READY_MS = 45_000;
const MAX_BUFFER = 10 * 1024 * 1024;

function npmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** 短命令：exec npm；Windows 需 shell 才能调 .cmd，但 windowsHide 保持静默。 */
function silentExecOptions(cwd: string): Parameters<typeof execFileAsync>[2] {
  return {
    cwd,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    timeout: DEFAULT_TIMEOUT_MS,
    encoding: "buffer",
    shell: process.platform === "win32",
  };
}

/**
 * 长进程 spawn 选项。
 * Windows：禁止 detached（会弹 CMD 窗），保留 shell + windowsHide 静默。
 * Unix：detached + unref，dev 可脱离 API 请求继续跑。
 */
function longRunningSpawnOptions(rootPath: string): SpawnOptions {
  if (process.platform === "win32") {
    return {
      cwd: rootPath,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    };
  }
  return {
    cwd: rootPath,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

async function runNpmScript(
  rootPath: string,
  script: string,
  passThroughArgs: string[] = [],
): Promise<{ stdout: Buffer | string; stderr: Buffer | string }> {
  const args = ["run", script, ...passThroughArgs];
  return execFileAsync(npmExecutable(), args, silentExecOptions(rootPath)) as Promise<{
    stdout: Buffer;
    stderr: Buffer;
  }>;
}

async function runLongRunningNpmScript(
  rootPath: string,
  script: string,
  passThroughArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const args = ["run", script, ...passThroughArgs];

  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child: ChildProcess | null = null;

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) {
        if (success && child.exitCode === null && !looksLikeDevAlreadyRunning(output)) {
          child.unref();
        } else if (!success && child.exitCode === null) {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        }
      }
      const formatted = formatShellOutputForDisplay(output);
      const alreadyRunning = looksLikeDevAlreadyRunning(formatted);
      const effectiveSuccess = success || alreadyRunning;
      let message = formatted;
      if (alreadyRunning) {
        message = appendPortBusyHint(formatted);
      } else if (effectiveSuccess) {
        message = `${formatted}\n\n（开发服务已在后台运行，输出不再阻塞 Agent。）`;
      } else {
        message =
          appendPortBusyHint(formatted) ||
          "命令无控制台输出（可能启动超时或被系统拦截）。若目标是 dev，请先检查 http://localhost:3000。";
      }
      resolve({
        stdout: message,
        stderr: "",
        success: effectiveSuccess,
      });
    };

    child = spawn(npmExecutable(), args, longRunningSpawnOptions(rootPath));

    const append = (chunk: Buffer) => {
      output += decodeChunk(chunk);
      if (looksLikeDevAlreadyRunning(output)) {
        finish(true);
        return;
      }
      if (looksLikeDevServerTerminalFailure(output)) {
        finish(false);
        return;
      }
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
      if (looksLikeDevAlreadyRunning(output)) {
        finish(true);
        return;
      }
      if (code === 0 || looksLikeDevServerReady(output)) {
        finish(true);
        return;
      }
      finish(false);
    });

    const timer = setTimeout(() => {
      if (looksLikeDevAlreadyRunning(output)) {
        finish(true);
        return;
      }
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
    silentExecOptions(rootPath),
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

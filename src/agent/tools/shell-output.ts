/**
 * Windows / npm 命令输出解码与命令规范化。
 */

/** 去掉 Vite/npm 等终端 ANSI 颜色码，避免聊天区乱码。 */
export function stripAnsiSequences(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/\u009b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function formatShellOutputForDisplay(text: string): string {
  return stripAnsiSequences(text).replace(/\r\n/g, "\n").trimEnd();
}

export function decodeProcessOutput(
  stdout: string | Buffer | undefined,
  stderr: string | Buffer | undefined,
): string {
  const parts = [decodeChunk(stdout), decodeChunk(stderr)].filter(Boolean);
  return formatShellOutputForDisplay(parts.join("\n"));
}

/** dev / watch 等长期运行脚本，不应阻塞到进程退出。 */
export function isLongRunningNpmScript(script: string): boolean {
  return /^(dev(?::\w+)?|start|serve|watch|preview|electron)$/i.test(script);
}

export function looksLikeDevServerReady(output: string): boolean {
  const text = formatShellOutputForDisplay(output);
  return (
    /\bready in \d+/i.test(text) ||
    /\bLocal:\s*https?:\/\//i.test(text) ||
    /\bNetwork:\s*https?:\/\//i.test(text)
  );
}

export function appendPortBusyHint(output: string): string {
  const text = formatShellOutputForDisplay(output);
  if (!/Port \d+ is in use/i.test(text) || looksLikeDevServerReady(text)) {
    return text;
  }
  return `${text}\n\n提示：5173/5174 等端口已被占用。可能已有 dev 进程在运行（可先打开 http://localhost:5173）；若需重启，请在任务管理器结束 node 进程后再试。`;
}

export function decodeChunk(value: string | Buffer | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.length === 0) return "";
  if (process.platform === "win32") {
    try {
      return new TextDecoder("gb18030").decode(value);
    } catch {
      return value.toString("utf8");
    }
  }
  return value.toString("utf8");
}

/** 修正 Agent 常见误写：npm run build 'vite' → npm run build */
export function sanitizeShellCommand(command: string): string {
  let normalized = command.replace(/\s+/g, " ").trim();
  const npmMatch = /^npm\s+run\s+([^\s'"`]+)(?:\s+(.+))?$/i.exec(normalized);
  if (!npmMatch) return normalized;

  const script = npmMatch[1];
  let extra = npmMatch[2]?.trim();
  if (extra && /^['"][^'"]+['"]$/.test(extra)) {
    const bare = extra.slice(1, -1);
    if (/^[a-zA-Z0-9_-]+$/.test(bare)) {
      return `npm run ${script}`;
    }
    extra = `-- ${bare}`;
  }
  return extra ? `npm run ${script} ${extra}` : `npm run ${script}`;
}

export type ParsedNpmRun = {
  script: string;
  passThroughArgs: string[];
};

export function parseNpmRunCommand(command: string): ParsedNpmRun | null {
  const sanitized = sanitizeShellCommand(command);
  const match = /^npm\s+run\s+([^\s'"`]+)(?:\s+(.*))?$/i.exec(sanitized);
  if (!match) return null;
  const script = match[1];
  const tail = match[2]?.trim();
  if (!tail) return { script, passThroughArgs: [] };
  if (tail.startsWith("--")) {
    return { script, passThroughArgs: tail.slice(2).trim().split(/\s+/).filter(Boolean) };
  }
  return { script, passThroughArgs: tail.split(/\s+/).filter(Boolean) };
}

export function summarizeShellFailureOutput(output: string, maxLines = 12): string {
  const lines = appendPortBusyHint(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Command failed:"))
    .filter((line) => !/^cmd\.exe\s/i.test(line));
  if (lines.length === 0) return "命令执行失败（无输出）。";
  return lines.slice(-maxLines).join("\n");
}

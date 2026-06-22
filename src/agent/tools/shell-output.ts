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

/** Next.js 同目录已有 dev 实例（换端口也无法再起第二个）。 */
export function looksLikeDevAlreadyRunning(output: string): boolean {
  return /another next dev server is already running/i.test(
    formatShellOutputForDisplay(output),
  );
}

/** 应阻止「就绪」判定的终端失败（含 Next 重复实例、端口占用）。 */
export function looksLikeDevServerTerminalFailure(output: string): boolean {
  const text = formatShellOutputForDisplay(output);
  return (
    looksLikeDevAlreadyRunning(text) ||
    /EADDRINUSE/i.test(text) ||
    /address already in use/i.test(text) ||
    (/Port \d+ is in use/i.test(text) && !/\bready in \d+/i.test(text))
  );
}

export function looksLikeDevServerReady(output: string): boolean {
  const text = formatShellOutputForDisplay(output);
  if (looksLikeDevServerTerminalFailure(text)) return false;
  return (
    /\bready in \d+/i.test(text) ||
    /[✓✔]\s*ready/i.test(text) ||
    /\bLocal:\s*https?:\/\//i.test(text) ||
    /\bNetwork:\s*https?:\/\//i.test(text) ||
    /▲\s*Next\.js/i.test(text)
  );
}

export function appendPortBusyHint(output: string): string {
  const text = formatShellOutputForDisplay(output);
  if (looksLikeDevAlreadyRunning(text)) {
    const url =
      text.match(/Local:\s*(https?:\/\/[^\s]+)/i)?.[1] ?? "http://localhost:3000";
    return `${text}\n\n提示：本仓库已有 Next.js dev 在运行，无需再起第二个实例。请直接访问 ${url}；若需重启，先结束已有 node/next 进程。`;
  }
  if (!/Port \d+ is in use/i.test(text) || looksLikeDevServerReady(text)) {
    return text;
  }
  const isNext = /next\.js|next dev/i.test(text);
  const portHint = isNext ? "3000/3001" : "5173/5174";
  const urlHint = isNext ? "http://localhost:3000" : "http://localhost:5173";
  return `${text}\n\n提示：${portHint} 等端口已被占用。可能已有 dev 在运行（可先打开 ${urlHint}）；若需重启，请结束 node 进程后再试。`;
}

/** 端口占用时建议的下一条 dev 命令（供续跑 prompt / Agent 参考）。 */
export function suggestAlternateDevPort(command: string, preferredPort = 3001): string | null {
  const npmRun = parseNpmRunCommand(sanitizeShellCommand(command));
  if (!npmRun || !isLongRunningNpmScript(npmRun.script)) return null;
  const base = `npm run ${npmRun.script}`;
  const hasPort = npmRun.passThroughArgs.some(
    (arg, index, args) =>
      /^--port=\d+$/i.test(arg) ||
      arg === "--port" ||
      arg === "-p" ||
      (index > 0 && args[index - 1] === "--port"),
  );
  if (hasPort) return null;
  return `${base} -- --port ${preferredPort}`;
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

/** 将 Agent 误写的 -H/-p 转为 Next.js 认可的 --hostname / --port。 */
function normalizeDevPassThroughArgs(script: string, args: string[]): string[] {
  if (!/^dev/i.test(script) || args.length === 0) return args;
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-p" || arg === "--p") {
      const port = args[index + 1];
      if (port && /^\d+$/.test(port)) {
        out.push("--port", port);
        index += 1;
        continue;
      }
    }
    if (arg === "-H" || arg === "--H") {
      const host = args[index + 1];
      if (host) {
        out.push("--hostname", host);
        index += 1;
        continue;
      }
    }
    if (/^-p\d+$/.test(arg)) {
      out.push("--port", arg.slice(2));
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** 修正 Agent 常见误写：npm run build 'vite' → npm run build；-H/-p → --port。 */
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
  if (!extra) return `npm run ${script}`;

  const parsed = parseNpmRunCommand(`npm run ${script} ${extra}`);
  if (!parsed || parsed.passThroughArgs.length === 0) {
    return `npm run ${script} ${extra}`;
  }
  const normalizedArgs = normalizeDevPassThroughArgs(
    script,
    parsed.passThroughArgs,
  );
  return `npm run ${script} -- ${normalizedArgs.join(" ")}`;
}

export type ParsedNpmRun = {
  script: string;
  passThroughArgs: string[];
};

export function parseNpmRunCommand(command: string): ParsedNpmRun | null {
  const normalized = command.replace(/\s+/g, " ").trim();
  const match = /^npm\s+run\s+([^\s'"`]+)(?:\s+(.*))?$/i.exec(normalized);
  if (!match) return null;
  const script = match[1];
  const tail = match[2]?.trim();
  if (!tail) return { script, passThroughArgs: [] };
  if (tail.startsWith("--")) {
    return {
      script,
      passThroughArgs: tail.slice(2).trim().split(/\s+/).filter(Boolean),
    };
  }
  return { script, passThroughArgs: tail.split(/\s+/).filter(Boolean) };
}

export function summarizeShellFailureOutput(output: string, maxLines = 12): string {
  const enriched = appendPortBusyHint(output);
  const lines = enriched
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Command failed:"))
    .filter((line) => !/^cmd\.exe\s/i.test(line));
  if (lines.length === 0) {
    return "命令执行失败（无控制台输出，可能启动超时或进程被系统拦截）。若目标是启动 dev，请先检查 http://localhost:3000 是否已在运行。";
  }
  return lines.slice(-maxLines).join("\n");
}

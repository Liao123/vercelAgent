/**
 * 右栏终端面板：已批准 shell 命令的输出记录（A167 Phase 1，非交互 PTY）。
 */
export type TerminalLogEntry = {
  id: string;
  command: string;
  success: boolean;
  output: string;
  completedAt: string;
};

export function createTerminalLogEntry(input: {
  id: string;
  command: string;
  success: boolean;
  output: string;
  completedAt?: string;
}): TerminalLogEntry {
  return {
    id: input.id,
    command: input.command,
    success: input.success,
    output: input.output,
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

export function formatTerminalLogBlock(entry: TerminalLogEntry): string {
  const status = entry.success ? "OK" : "FAILED";
  const lines = [
    `\r\n\x1b[90m── ${entry.completedAt} ──\x1b[0m`,
    `\x1b[1m$ ${entry.command}\x1b[0m \x1b[${entry.success ? "32" : "31"}m[${status}]\x1b[0m`,
  ];
  if (entry.output.trim()) {
    lines.push(entry.output.replace(/\r?\n/g, "\r\n"));
  } else {
    lines.push("\x1b[90m(无输出)\x1b[0m");
  }
  return lines.join("\r\n");
}

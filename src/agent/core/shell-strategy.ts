/**
 * Shell 结果分层策略：把命令输出归类为可复用的恢复路径。
 */
import {
  looksLikeDevAlreadyRunning,
  suggestAlternateDevPort,
} from "@/agent/tools/shell-output";

export type ShellRecoveryTier =
  | "already_satisfied"
  | "port_conflict"
  | "timeout_or_no_output"
  | "generic_failure";

export type ShellRecoveryPlan = {
  tier: ShellRecoveryTier;
  headline: string;
  detail: string;
  suggestedCommand?: string;
};

function toBlob(output: string | null, error: string | undefined): string {
  return `${output ?? ""}\n${error ?? ""}`.toLowerCase();
}

function isPortConflict(blob: string): boolean {
  return /port \d+ is in use|eaddrinuse|address already in use|端口.*占用/.test(
    blob,
  );
}

function isTimeoutLike(blob: string): boolean {
  return /timed out|timeout|未在.*内就绪|无控制台输出|no output/.test(blob);
}

export function classifyShellRecoveryPlan(input: {
  command: string;
  output: string | null;
  error?: string;
}): ShellRecoveryPlan {
  const blob = toBlob(input.output, input.error);
  if (looksLikeDevAlreadyRunning(blob)) {
    return {
      tier: "already_satisfied",
      headline: "检测到同仓库 dev 已在运行",
      detail:
        "目标通常已达成：直接汇报可访问 URL；除非用户明确要求重启，否则不要再次 prepare dev。",
    };
  }

  if (isPortConflict(blob)) {
    return {
      tier: "port_conflict",
      headline: "端口冲突",
      detail:
        "先判断是否已有服务在跑；若需重启，结束占用进程后再改端口重试（仍需用户批准）。",
      suggestedCommand: suggestAlternateDevPort(input.command) ?? undefined,
    };
  }

  if (isTimeoutLike(blob)) {
    return {
      tier: "timeout_or_no_output",
      headline: "命令超时或无输出",
      detail:
        "可能是长启动过程或环境阻塞。应读取关键日志，必要时重试并提供下一条可执行命令。",
    };
  }

  return {
    tier: "generic_failure",
    headline: "通用命令失败",
    detail:
      "先读 package.json scripts / 配置定位根因，再给出下一条 shell.run.prepare 命令。",
  };
}

import type { AgentEvent } from "@/agent/types";
import { buildAssistantNoticeEvent } from "@/lib/approval-chat-events";

export const KERNEL_VALIDATE_REASON_PREFIX = "kernel-bootstrap-validate:";

/** 内核 validate 通过后建议在外部终端执行的重启命令（非 shell.prepare 长进程）。 */
export function suggestKernelDevRestartCommand(): string {
  const override = process.env.AGENT_KERNEL_RESTART_COMMAND?.trim();
  if (override) return override;
  return "npm run dev:desktop";
}

export function isKernelBootstrapValidateCommand(command: string): boolean {
  const normalized = command.trim();
  return (
    /^npm run validate:/i.test(normalized) ||
    (normalized.includes("validate:") && normalized.includes("npm run"))
  );
}

export function isKernelBootstrapValidateApproval(reason: string | undefined): boolean {
  return Boolean(reason?.startsWith(KERNEL_VALIDATE_REASON_PREFIX));
}

export function tagKernelBootstrapValidateApproval<
  T extends { reason?: string },
>(approval: T, validateCommand: string): T {
  return {
    ...approval,
    reason: `${KERNEL_VALIDATE_REASON_PREFIX} ${validateCommand}`,
  };
}

export function findKernelBootstrapValidateEvent(
  events: AgentEvent[],
  taskId: string,
): Extract<AgentEvent, { type: "kernel.bootstrap.validate" }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "kernel.bootstrap.validate") continue;
    if (event.taskId !== taskId) continue;
    return event;
  }
  return null;
}

export function findKernelBootstrapRestartEvent(
  events: AgentEvent[],
  taskId?: string | null,
): Extract<AgentEvent, { type: "kernel.bootstrap.restart" }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "kernel.bootstrap.restart") continue;
    if (taskId && event.taskId !== taskId) continue;
    return event;
  }
  return null;
}

export function appendKernelBootstrapRestartAfterValidate(
  events: AgentEvent[],
  input: {
    taskId: string;
    command: string;
    success: boolean;
  },
): AgentEvent[] {
  if (!input.success || !isKernelBootstrapValidateCommand(input.command)) {
    return events;
  }
  const bootstrap = findKernelBootstrapValidateEvent(events, input.taskId);
  if (!bootstrap?.requiresDevRestart) return events;
  if (findKernelBootstrapRestartEvent(events, input.taskId)) return events;

  const restartCommand = suggestKernelDevRestartCommand();
  const message = `内核 validate 已通过。请在外部终端重启 dev（例如 ${restartCommand}），使 Loop / MCP / agent-server 改动生效。`;

  return [
    ...events,
    {
      type: "kernel.bootstrap.restart",
      taskId: input.taskId,
      message,
      validateCommand: bootstrap.validateCommand,
      restartCommand,
    },
    buildAssistantNoticeEvent({
      taskId: input.taskId,
      message,
      tone: "neutral",
    }),
  ];
}

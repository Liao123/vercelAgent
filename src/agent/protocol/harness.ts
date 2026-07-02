/**
 * 阶段 D：Agent Harness 协议（vec-next 自研，对齐 Codex App Server 思路）。
 *
 * - Loop：SSE，`event` = AgentEvent.type，`data` = AgentEvent JSON
 * - PTY：SSE，仅 `data` = PtyStreamEvent JSON（EventSource onmessage）
 * - MCP / 控制面：JSON REST（见 HARNESS_ROUTES）
 */
import type { AgentEvent } from "@/agent/types";
import type { PtyStreamEvent } from "@/agent/terminal/pty-session-manager";

export const HARNESS_PROTOCOL_VERSION = "1.0";

export const HARNESS_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export const HARNESS_ROUTES = {
  health: { method: "GET", path: "/health" },
  loop: { method: "POST", path: "/loop", stream: "agent-loop" as const },
  traceList: { method: "GET", path: "/trace" },
  traceById: { method: "GET", path: "/trace?id=:traceId" },
  traceByTask: { method: "GET", path: "/trace?taskId=:taskId" },
  mcpStatus: { method: "GET", path: "/mcp" },
  mcpTools: { method: "GET", path: "/mcp/tools" },
  mcpReload: { method: "POST", path: "/mcp/reload" },
  mcpCall: { method: "POST", path: "/mcp/call" },
  ptyStatus: { method: "GET", path: "/pty" },
  ptyAction: { method: "POST", path: "/pty" },
  ptyStream: {
    method: "GET",
    path: "/pty/:sessionId/stream",
    stream: "pty" as const,
  },
} as const;

/** Loop SSE 已注册事件名（与 AgentEvent.type 对齐，供文档与校验）。 */
export const HARNESS_LOOP_EVENT_TYPES = [
  "thread.created",
  "task.created",
  "trace.linked",
  "trace.checkpoint",
  "turn.created",
  "plan.updated",
  "playbook.matched",
  "playbook.progress",
  "model.delta",
  "tool.started",
  "tool.completed",
  "approval.required",
  "approval.executed",
  "assistant.notice",
  "file.changed",
  "turn.diff.updated",
  "kernel.bootstrap.validate",
  "kernel.bootstrap.restart",
  "verification.completed",
  "context.compacted",
  "reflection.updated",
  "task.completed",
  "task.awaiting_approval",
  "task.failed",
  "task.cancelled",
] as const;

export type HarnessLoopEventType = (typeof HARNESS_LOOP_EVENT_TYPES)[number];

export type HarnessStreamKind = "agent-loop" | "pty";

export type HarnessHealthPayload = {
  ok: true;
  harness: {
    version: typeof HARNESS_PROTOCOL_VERSION;
    routes: typeof HARNESS_ROUTES;
  };
  pid: number;
  uptimeMs: number;
  loop: { enabled: boolean; path: string; stream: HarnessStreamKind };
  pty: { enabled: boolean; path: string; stream: HarnessStreamKind };
  mcp: {
    enabled: boolean;
    connectedServers: number;
    toolCount: number;
  };
};

export function formatAgentLoopSseFrame(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatPtyStreamSseFrame(event: PtyStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function buildHarnessHealthPayload(input: {
  pid: number;
  uptimeMs: number;
  ptyEnabled: boolean;
  mcp: {
    enabled: boolean;
    connectedServers: number;
    toolCount: number;
  };
}): HarnessHealthPayload {
  return {
    ok: true,
    harness: {
      version: HARNESS_PROTOCOL_VERSION,
      routes: HARNESS_ROUTES,
    },
    pid: input.pid,
    uptimeMs: input.uptimeMs,
    loop: {
      enabled: true,
      path: HARNESS_ROUTES.loop.path,
      stream: HARNESS_ROUTES.loop.stream,
    },
    pty: {
      enabled: input.ptyEnabled,
      path: HARNESS_ROUTES.ptyStatus.path,
      stream: HARNESS_ROUTES.ptyStream.stream,
    },
    mcp: input.mcp,
  };
}

export function isHarnessLoopEventType(
  value: string,
): value is HarnessLoopEventType {
  return (HARNESS_LOOP_EVENT_TYPES as readonly string[]).includes(value);
}

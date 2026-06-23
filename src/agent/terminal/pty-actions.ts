import {
  getPtySession,
  isAgentPtyEnabled,
  killPtySession,
  resizePtySession,
  spawnPtySession,
  writePtySession,
} from "@/agent/terminal/pty-session-manager";

export type PtyActionBody = {
  action?: unknown;
  sessionId?: unknown;
  data?: unknown;
  cols?: unknown;
  rows?: unknown;
  workspaceRoot?: unknown;
};

export type PtyActionResult =
  | { status: number; body: Record<string, unknown> };

export function ptyStatusPayload(): Record<string, unknown> {
  return {
    enabled: isAgentPtyEnabled(),
    platform: process.platform,
  };
}

export function executePtyAction(
  body: PtyActionBody,
  defaultWorkspaceRoot: string,
): PtyActionResult {
  if (!isAgentPtyEnabled()) {
    return {
      status: 503,
      body: { error: "Interactive PTY is disabled." },
    };
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (action === "spawn") {
    const workspaceRoot =
      typeof body.workspaceRoot === "string" && body.workspaceRoot.trim()
        ? body.workspaceRoot.trim()
        : defaultWorkspaceRoot;
    const session = spawnPtySession(workspaceRoot);
    return { status: 200, body: { session } };
  }

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return { status: 400, body: { error: "sessionId is required." } };
  }

  if (action === "write") {
    if (typeof body.data !== "string") {
      return { status: 400, body: { error: "data must be a string." } };
    }
    writePtySession(sessionId, body.data);
    return { status: 200, body: { ok: true } };
  }

  if (action === "resize") {
    if (typeof body.cols !== "number" || typeof body.rows !== "number") {
      return {
        status: 400,
        body: { error: "cols and rows must be numbers." },
      };
    }
    resizePtySession(sessionId, body.cols, body.rows);
    return { status: 200, body: { ok: true } };
  }

  if (action === "kill") {
    killPtySession(sessionId);
    return { status: 200, body: { ok: true } };
  }

  if (action === "status") {
    const session = getPtySession(sessionId);
    if (!session) {
      return { status: 404, body: { error: "PTY session not found." } };
    }
    return { status: 200, body: { session } };
  }

  return { status: 400, body: { error: "Unknown action." } };
}

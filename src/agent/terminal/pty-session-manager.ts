/**
 * A168：交互式 PTY 会话（node-pty，workspace cwd）。
 */
import { randomUUID } from "node:crypto";
import * as nodePty from "node-pty";
import type { IPty } from "node-pty";

export type PtyStreamEvent =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number | null };

export type PtySessionInfo = {
  id: string;
  workspaceRoot: string;
  shell: string;
  createdAt: string;
};

type PtySession = PtySessionInfo & {
  pty: IPty;
  subscribers: Set<(event: PtyStreamEvent) => void>;
  lastActiveAt: number;
};

const MAX_SESSIONS = 6;
const IDLE_TTL_MS = 30 * 60 * 1000;

const sessions = new Map<string, PtySession>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function isAgentPtyEnabled(): boolean {
  return process.env.AGENT_PTY_ENABLED !== "0";
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.SHELL?.trim() || "powershell.exe";
  }
  return process.env.SHELL?.trim() || "/bin/bash";
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActiveAt > IDLE_TTL_MS) {
        killPtySession(id);
      }
    }
  }, 60_000);
  cleanupTimer.unref?.();
}

function emit(session: PtySession, event: PtyStreamEvent): void {
  for (const subscriber of session.subscribers) {
    subscriber(event);
  }
}

function loadNodePty(): typeof nodePty {
  return nodePty;
}

export function spawnPtySession(workspaceRoot: string): PtySessionInfo {
  if (!isAgentPtyEnabled()) {
    throw new Error("Interactive PTY is disabled (AGENT_PTY_ENABLED=0).");
  }
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error("Too many active PTY sessions.");
  }

  const pty = loadNodePty();
  const shell = defaultShell();
  const id = `pty_${randomUUID()}`;
  const createdAt = new Date().toISOString();

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: workspaceRoot,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
    ...(process.platform === "win32" ? { useConpty: false } : {}),
  });

  const session: PtySession = {
    id,
    workspaceRoot,
    shell,
    createdAt,
    pty: ptyProcess,
    subscribers: new Set(),
    lastActiveAt: Date.now(),
  };

  ptyProcess.onData((data) => {
    session.lastActiveAt = Date.now();
    emit(session, { type: "output", data });
  });
  ptyProcess.onExit(({ exitCode }) => {
    emit(session, { type: "exit", exitCode });
    sessions.delete(id);
  });

  sessions.set(id, session);
  ensureCleanupTimer();

  return {
    id,
    workspaceRoot,
    shell,
    createdAt,
  };
}

export function getPtySession(sessionId: string): PtySessionInfo | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return {
    id: session.id,
    workspaceRoot: session.workspaceRoot,
    shell: session.shell,
    createdAt: session.createdAt,
  };
}

export function writePtySession(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("PTY session not found.");
  session.lastActiveAt = Date.now();
  session.pty.write(data);
}

export function resizePtySession(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("PTY session not found.");
  session.lastActiveAt = Date.now();
  session.pty.resize(
    Math.max(2, Math.min(cols, 400)),
    Math.max(2, Math.min(rows, 200)),
  );
}

export function killPtySession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    session.pty.kill();
  } catch {
    /* ignore */
  }
  sessions.delete(sessionId);
  return true;
}

export function subscribePtySession(
  sessionId: string,
  listener: (event: PtyStreamEvent) => void,
): (() => void) | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.subscribers.add(listener);
  return () => {
    session.subscribers.delete(listener);
  };
}

/** 测试/validate 用 */
export function clearAllPtySessionsForTests(): void {
  for (const id of [...sessions.keys()]) {
    killPtySession(id);
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { getCurrentWorkspace } from "@/agent/workspace";
import {
  executePtyAction,
  ptyStatusPayload,
  type PtyActionBody,
} from "@/agent/terminal/pty-actions";
import {
  getPtySession,
  subscribePtySession,
} from "@/agent/terminal/pty-session-manager";
import {
  buildHarnessHealthPayload,
  formatPtyStreamSseFrame,
} from "@/agent/protocol/harness";
import { beginSseResponse, endSseResponse } from "@/agent-server/sse";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

export function handlePtyGet(res: ServerResponse): void {
  sendJson(res, 200, ptyStatusPayload());
}

export async function handlePtyPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: PtyActionBody;
  try {
    body = (await readJsonBody(req)) as PtyActionBody;
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const workspace = await getCurrentWorkspace();
    const result = executePtyAction(body, workspace.rootPath);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "PTY request failed.",
    });
  }
}

export function handlePtyStreamGet(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): void {
  const trimmed = sessionId.trim();
  if (!trimmed || !getPtySession(trimmed)) {
    sendJson(res, 404, { error: "PTY session not found." });
    return;
  }

  beginSseResponse(res);

  const unsubscribe = subscribePtySession(trimmed, (event) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(formatPtyStreamSseFrame(event));
      if (event.type === "exit") {
        unsubscribe?.();
        endSseResponse(res);
      }
    } catch {
      unsubscribe?.();
      endSseResponse(res);
    }
  });

  if (!unsubscribe) {
    endSseResponse(res);
    return;
  }

  const cleanup = () => {
    unsubscribe();
    endSseResponse(res);
  };

  req.on("aborted", cleanup);
  req.on("close", () => {
    if (!req.complete) cleanup();
  });
}

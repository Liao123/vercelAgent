import type { IncomingMessage, ServerResponse } from "node:http";
import {
  GuidanceNotAcceptedError,
  submitUserGuidance,
} from "@/agent/core/loop-user-guidance";
import {
  parseAgentGuidanceRequestBody,
  type AgentGuidanceRequestBody,
} from "@/agent/protocol/guidance-request";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function handleAgentGuidancePost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: AgentGuidanceRequestBody;
  try {
    body = (await readJsonBody(req)) as AgentGuidanceRequestBody;
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const parsed = parseAgentGuidanceRequestBody(body);
  if ("error" in parsed) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const item = submitUserGuidance(parsed.threadId, parsed.text);
    sendJson(res, 200, {
      ok: true,
      id: item.id,
      at: item.at,
      text: item.text,
    });
  } catch (error) {
    if (error instanceof GuidanceNotAcceptedError) {
      sendJson(res, 409, { error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
}

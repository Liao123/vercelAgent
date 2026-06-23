import type { ServerResponse } from "node:http";
import type { AgentEvent } from "@/agent/types";
import {
  formatAgentLoopSseFrame,
  HARNESS_SSE_HEADERS,
} from "@/agent/protocol/harness";

export const SSE_HEADERS = HARNESS_SSE_HEADERS;

export function beginSseResponse(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
}

export function writeSseEvent(res: ServerResponse, event: AgentEvent): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(formatAgentLoopSseFrame(event));
    return true;
  } catch {
    return false;
  }
}

export function endSseResponse(res: ServerResponse): void {
  if (!res.writableEnded) res.end();
}

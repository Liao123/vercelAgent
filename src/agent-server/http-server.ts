/**
 * 阶段 B：本地 agent-server 雏形 — 长驻 MCP 子进程，供 Next / Electron 通过 HTTP 复用。
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  callMcpTool,
  ensureMcpRegistryReady,
  getMcpRegistrySnapshot,
  getMcpToolDefinitions,
  reloadMcpRegistry,
  resolveMcpToolBinding,
} from "@/agent/mcp/registry";
import {
  defaultAgentServerListenHost,
  resolveAgentServerPort,
} from "@/agent-server/config";
import { handleAgentGuidancePost } from "@/agent-server/guidance-handler";
import { handleAgentLoopPost } from "@/agent-server/loop-handler";
import { handleTraceGet } from "@/agent-server/trace-handler";
import {
  handlePtyGet,
  handlePtyPost,
  handlePtyStreamGet,
} from "@/agent-server/pty-handler";
import { isAgentPtyEnabled } from "@/agent/terminal/pty-session-manager";
import { buildHarnessHealthPayload } from "@/agent/protocol/harness";

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
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

export type AgentHttpServer = http.Server & {
  port: number;
  host: string;
};

export async function startAgentHttpServer(): Promise<AgentHttpServer> {
  const startedAt = Date.now();
  const host = defaultAgentServerListenHost();
  const port = resolveAgentServerPort();

  await ensureMcpRegistryReady();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (req.method === "GET" && path === "/health") {
        const snapshot = getMcpRegistrySnapshot();
        sendJson(
          res,
          200,
          buildHarnessHealthPayload({
            pid: process.pid,
            uptimeMs: Date.now() - startedAt,
            ptyEnabled: isAgentPtyEnabled(),
            mcp: {
              enabled: snapshot.enabled,
              connectedServers: snapshot.servers.filter((s) => s.connected)
                .length,
              toolCount: snapshot.tools.length,
            },
          }),
        );
        return;
      }

      if (req.method === "GET" && path === "/mcp") {
        sendJson(res, 200, getMcpRegistrySnapshot());
        return;
      }

      if (req.method === "GET" && path === "/mcp/tools") {
        sendJson(res, 200, { tools: getMcpToolDefinitions() });
        return;
      }

      if (req.method === "POST" && path === "/mcp/reload") {
        const snapshot = await reloadMcpRegistry();
        sendJson(res, 200, { ok: true, ...snapshot });
        return;
      }

      if (req.method === "POST" && path === "/mcp/call") {
        const body = (await readJsonBody(req)) as {
          internalName?: unknown;
          args?: unknown;
        };
        const internalName =
          typeof body.internalName === "string" ? body.internalName.trim() : "";
        if (!internalName) {
          sendJson(res, 400, { error: "internalName is required" });
          return;
        }
        const binding = resolveMcpToolBinding(internalName);
        if (!binding) {
          sendJson(res, 404, { error: `MCP tool not found: ${internalName}` });
          return;
        }
        const args =
          body.args && typeof body.args === "object" && !Array.isArray(body.args)
            ? (body.args as Record<string, unknown>)
            : {};
        const result = await callMcpTool(binding, args);
        sendJson(res, 200, { ok: true, result });
        return;
      }

      if (req.method === "POST" && path === "/loop") {
        await handleAgentLoopPost(req, res);
        return;
      }

      if (req.method === "POST" && path === "/guidance") {
        await handleAgentGuidancePost(req, res);
        return;
      }

      if (req.method === "GET" && path === "/trace") {
        await handleTraceGet(req, res, url);
        return;
      }

      if (req.method === "GET" && path === "/pty") {
        handlePtyGet(res);
        return;
      }

      if (req.method === "POST" && path === "/pty") {
        await handlePtyPost(req, res);
        return;
      }

      const ptyStreamMatch = path.match(/^\/pty\/([^/]+)\/stream$/);
      if (req.method === "GET" && ptyStreamMatch) {
        handlePtyStreamGet(req, res, decodeURIComponent(ptyStreamMatch[1]!));
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  }) as AgentHttpServer;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  server.host = host;
  server.port = port;
  return server;
}

/**
 * 本地 agent-server：长驻 MCP，避免 Next 热重载反复拉起 chrome-devtools-mcp。
 *
 * 用法：
 *   npm run agent-server
 *   AGENT_SERVER_URL=http://127.0.0.1:3920 npm run dev
 *
 * 启动时会加载项目根 `.env` / `.env.local`（不覆盖 shell 已有变量），
 * 以便 /loop 远程代理时也能读到模型 API 配置。
 */
import { loadAgentServerEnv } from "../src/agent-server/load-env.ts";
import { startAgentHttpServer } from "../src/agent-server/http-server.ts";

async function main(): Promise<void> {
  const envFiles = loadAgentServerEnv();
  if (envFiles.length > 0) {
    console.log(`[agent-server] loaded env: ${envFiles.join(", ")}`);
  }

  process.env.AGENT_SERVER_HOSTING = "1";
  delete process.env.AGENT_SERVER_URL;

  const server = await startAgentHttpServer();
  const url = `http://${server.host}:${server.port}`;
  console.log(`[agent-server] listening on ${url}`);
  console.log("[agent-server] MCP warmed; set AGENT_SERVER_URL for Next.js to proxy MCP");

  const shutdown = async (signal: string) => {
    console.log(`[agent-server] ${signal}, shutting down…`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const { resetMcpRegistry } = await import("../src/agent/mcp/registry.ts");
    await resetMcpRegistry();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[agent-server] fatal:", error);
  process.exit(1);
});

/**
 * chrome-devtools MCP 连通性试用。
 *
 * 前置条件：
 *   1. 已配置 MCP（mcp.json / ~/.cursor/mcp.json / AGENT_MCP_SERVERS）
 *   2. Chrome 已启动且可被 chrome-devtools-mcp 连接（通常需 --remote-debugging-port）
 *
 * 用法：
 *   npm run trial:mcp-chrome-devtools
 *   npx tsx scripts/mcp-chrome-devtools-trial.ts
 *   AGENT_MCP_CONFIG=./mcp.json npx tsx scripts/mcp-chrome-devtools-trial.ts --url https://example.com
 *
 * 可选：dev 已启动时加 --http 会额外请求 GET /api/agent/mcp
 */
import fs from "node:fs";
import path from "node:path";
import {
  callMcpTool,
  ensureMcpRegistryReady,
  getMcpRegistrySnapshot,
  isMcpIntegrationEnabled,
  reloadMcpRegistry,
  resolveMcpConfigPath,
  resetMcpRegistry,
} from "../src/agent/mcp/index.ts";

const SERVER_ID = "chrome-devtools";
const DEFAULT_URL = "https://example.com";
const OUT_DIR = path.join(process.cwd(), ".agent-state");
const SCREENSHOT_PATH = path.join(OUT_DIR, "mcp-trial-screenshot.png");

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.MCP_TRIAL_URL?.trim() || DEFAULT_URL;
  let useHttp = false;
  let skipPerf = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--http") useHttp = true;
    else if (arg === "--skip-perf") skipPerf = true;
    else if (arg === "--url" && args[i + 1]) {
      url = args[i + 1]!;
      i += 1;
    } else if (!arg.startsWith("--") && arg.startsWith("http")) {
      url = arg;
    }
  }
  return { url, useHttp, skipPerf };
}

function step(label: string) {
  console.log(`\n▶ ${label}`);
}

function ok(label: string, detail?: string) {
  console.log(`  ✓ ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function summarizeResult(result: unknown, maxLen = 240): string {
  if (typeof result === "string") {
    return result.length > maxLen ? `${result.slice(0, maxLen)}…` : result;
  }
  const json = JSON.stringify(result);
  return json.length > maxLen ? `${json.slice(0, maxLen)}…` : json;
}

async function callDevTools(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return callMcpTool({ serverId: SERVER_ID, toolName }, args);
}

async function verifyMcpConfig(): Promise<void> {
  step("检查 MCP 配置");
  if (!isMcpIntegrationEnabled()) {
    fail(
      "MCP 未启用。请复制 mcp.config.example.json → mcp.json，或设置 AGENT_MCP_ENABLED=1",
    );
  }
  const configPath = resolveMcpConfigPath();
  ok("MCP 已启用", configPath ?? "AGENT_MCP_SERVERS");
}

async function connectRegistry(): Promise<void> {
  step("连接 MCP 服务器");
  await reloadMcpRegistry();
  const snapshot = getMcpRegistrySnapshot();
  const server = snapshot.servers.find((item) => item.id === SERVER_ID);
  if (!server) {
    fail(
      `未找到「${SERVER_ID}」服务器。请在 mcp.json 的 mcpServers 中添加 chrome-devtools 配置。`,
    );
  }
  if (!server.connected) {
    fail(
      server.error ??
        `${SERVER_ID} 连接失败。请确认 npx 可用，且 chrome-devtools-mcp 能启动。`,
    );
  }
  ok(`${SERVER_ID} 已连接`, `${server.toolCount} 个工具 · ${server.transport}`);
  const sampleTools = snapshot.tools
    .filter((tool) => tool.serverId === SERVER_ID)
    .slice(0, 5)
    .map((tool) => tool.toolName)
    .join(", ");
  if (sampleTools) ok("工具示例", sampleTools);
}

async function runBrowserFlow(url: string, skipPerf: boolean): Promise<void> {
  step("list_pages");
  const pages = await callDevTools("list_pages", {});
  ok("list_pages", summarizeResult(pages));

  step(`navigate_page → ${url}`);
  const nav = await callDevTools("navigate_page", { type: "url", url });
  ok("navigate_page", summarizeResult(nav));

  step("take_snapshot");
  const snapshot = await callDevTools("take_snapshot", {});
  ok("take_snapshot", summarizeResult(snapshot, 120));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  step(`take_screenshot → ${SCREENSHOT_PATH}`);
  const shot = await callDevTools("take_screenshot", {
    format: "png",
    filePath: SCREENSHOT_PATH,
  });
  ok("take_screenshot", summarizeResult(shot));
  if (fs.existsSync(SCREENSHOT_PATH)) {
    ok("截图已写入", `${SCREENSHOT_PATH} (${fs.statSync(SCREENSHOT_PATH).size} bytes)`);
  }

  if (skipPerf) {
    console.log("\n  (已跳过 performance trace；默认会跑，可用 --skip-perf 跳过)");
    return;
  }

  step("performance_start_trace (autoStop)");
  try {
    const trace = await callDevTools("performance_start_trace", {
      reload: false,
      autoStop: true,
    });
    ok("performance_start_trace", summarizeResult(trace, 180));
  } catch (error) {
    console.warn(
      `  ⚠ performance trace 失败（可忽略）: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function verifyDevHttpApi(baseUrl: string): Promise<void> {
  step(`HTTP 探测 ${baseUrl}/api/agent/mcp`);
  try {
    const res = await fetch(`${baseUrl}/api/agent/mcp`);
    const data = (await res.json()) as {
      enabled?: boolean;
      servers?: Array<{ id: string; connected: boolean; toolCount: number }>;
      error?: string;
    };
    if (!res.ok) {
      console.warn(`  ⚠ HTTP ${res.status}: ${data.error ?? "unknown"}`);
      return;
    }
    const devtools = data.servers?.find((s) => s.id === SERVER_ID);
    ok(
      "dev API",
      devtools
        ? `${SERVER_ID} connected=${devtools.connected} tools=${devtools.toolCount}`
        : `enabled=${data.enabled}`,
    );
  } catch (error) {
    console.warn(
      `  ⚠ dev 未启动或不可达: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function printAgentTaskPrompt(url: string): void {
  console.log(`
────────────────────────────────────────
可在 Agent 输入框粘贴的试用任务：

打开 ${url}，用 chrome-devtools MCP 截图并简要描述页面标题与主要内容；
若可用，跑一次 performance trace 并总结 LCP/加载耗时相关发现。

（需 dev 已启动且 MCP 配置生效；Agent 会自动看到 mcp.chrome-devtools.* 工具）
────────────────────────────────────────`);
}

async function main(): Promise<void> {
  const { url, useHttp, skipPerf } = parseArgs();
  console.log("mcp-chrome-devtools-trial");
  console.log(`  target: ${url}`);

  await verifyMcpConfig();
  await connectRegistry();

  try {
    await runBrowserFlow(url, skipPerf);
  } finally {
    await resetMcpRegistry();
  }

  if (useHttp) {
    const base = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
    await verifyDevHttpApi(base);
  }

  printAgentTaskPrompt(url);
  console.log("\nmcp-chrome-devtools-trial: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

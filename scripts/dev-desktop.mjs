/**
 * 启动 Next dev + Electron 桌面壳（需已 npm install）。
 *
 * 用法：npm run dev:desktop
 * 若 3000 已有 dev 在跑，会跳过重复启动，直接开 Electron。
 * 默认会尝试启动 agent-server（长驻 MCP），并注入 AGENT_SERVER_URL。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const devBase = process.env.VEC_DESKTOP_URL?.trim() || "http://localhost:3000";
const agentServerPort = process.env.AGENT_SERVER_PORT?.trim() || "3920";
const agentServerUrl =
  process.env.AGENT_SERVER_URL?.trim() ||
  `http://127.0.0.1:${agentServerPort}`;

/** @type {import("node:child_process").ChildProcess | null} */
let dev = null;
/** @type {import("node:child_process").ChildProcess | null} */
let agentServer = null;
let electronStarted = false;
let weStartedDev = false;
let weStartedAgentServer = false;

function run(command, args, env = {}) {
  return spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function runDetached(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.unref();
  return child;
}

async function serverReady(base) {
  try {
    const res = await fetch(`${base}/api/agent/workspace`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function agentServerReady(base) {
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverReady(base)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function waitForAgentServer(base, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await agentServerReady(base)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function ensureAgentServer() {
  if (process.env.AGENT_SERVER_SKIP === "1") {
    console.log("[dev:desktop] 跳过 agent-server（AGENT_SERVER_SKIP=1）");
    return null;
  }
  if (await agentServerReady(agentServerUrl)) {
    console.log("[dev:desktop] agent-server 已运行:", agentServerUrl);
    return agentServerUrl;
  }
  console.log("[dev:desktop] 启动 agent-server…", agentServerUrl);
  weStartedAgentServer = true;
  agentServer = runDetached(npmCmd, ["run", "agent-server"], {
    AGENT_SERVER_PORT: agentServerPort,
  });
  const ready = await waitForAgentServer(agentServerUrl);
  if (!ready) {
    console.warn(
      "[dev:desktop] agent-server 未在 90s 内就绪，Next 将回退为进程内 MCP。",
    );
    return null;
  }
  console.log("[dev:desktop] agent-server 就绪");
  return agentServerUrl;
}

function launchElectron() {
  if (electronStarted) return;
  electronStarted = true;
  console.log("[dev:desktop] 启动 Electron…");
  run(npmCmd, ["run", "electron:raw"], {
    VEC_DESKTOP_URL: devBase,
  });
}

async function main() {
  console.log("[dev:desktop] Agent 地址:", devBase);
  const resolvedAgentServerUrl = await ensureAgentServer();
  const devEnv = {
    VEC_DESKTOP_URL: devBase,
    ...(resolvedAgentServerUrl
      ? {
          AGENT_SERVER_URL: resolvedAgentServerUrl,
          AGENT_LOOP_REMOTE:
            process.env.AGENT_LOOP_REMOTE?.trim() || "0",
        }
      : {}),
  };

  if (await serverReady(devBase)) {
    console.log("[dev:desktop] 检测到已有 Agent 服务，跳过 npm run dev。");
    launchElectron();
    return;
  }

  console.log("[dev:desktop] 启动 npm run dev…");
  weStartedDev = true;
  dev = run(npmCmd, ["run", "dev"], devEnv);

  const ready = await waitForServer(devBase);
  if (!ready) {
    console.error(
      `[dev:desktop] ${devBase} 在 120s 内未就绪。若已有 dev 占用了其他端口，请先结束旧进程再重试。`,
    );
    process.exit(1);
  }

  launchElectron();
}

void main();

function shutdown() {
  if (weStartedDev && dev) dev.kill();
  if (weStartedAgentServer && agentServer) {
    try {
      agentServer.kill();
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

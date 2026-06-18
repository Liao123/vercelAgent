/**
 * 启动 Next dev + Electron 桌面壳（需已 npm install）。
 *
 * 用法：npm run dev:desktop
 * 若 3000 已有 dev 在跑，会跳过重复启动，直接开 Electron。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const devBase = process.env.VEC_DESKTOP_URL?.trim() || "http://localhost:3000";

/** @type {import("node:child_process").ChildProcess | null} */
let dev = null;
let electronStarted = false;
let weStartedDev = false;

function run(command, args, env = {}) {
  return spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
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

async function waitForServer(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverReady(base)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
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

  if (await serverReady(devBase)) {
    console.log("[dev:desktop] 检测到已有 Agent 服务，跳过 npm run dev。");
    launchElectron();
    return;
  }

  console.log("[dev:desktop] 启动 npm run dev…");
  weStartedDev = true;
  dev = run(npmCmd, ["run", "dev"], {
    VEC_DESKTOP_URL: devBase,
  });

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
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

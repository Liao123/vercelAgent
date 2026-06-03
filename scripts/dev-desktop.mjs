/**
 * 启动 Next dev + Electron 桌面壳（需已 npm install）。
 *
 * 用法：npm run dev:desktop
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, env = {}) {
  return spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const devBase = process.env.VEC_DESKTOP_URL?.trim() || "http://localhost:3000";

const dev = run(npmCmd, ["run", "dev"], {
  VEC_DESKTOP_URL: devBase,
});

let electronStarted = false;

async function waitAndLaunchElectron() {
  const base = devBase;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/agent/workspace`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) break;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  if (!electronStarted) {
    electronStarted = true;
    run(npmCmd, ["run", "electron"], {
      VEC_DESKTOP_URL: base,
    });
  }
}

void waitAndLaunchElectron();

function shutdown() {
  dev.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

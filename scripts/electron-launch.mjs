/**
 * 开发时启动 Electron 桌面壳。
 * - 若 Agent 服务未就绪：Windows 新开 CMD 跑 `npm run dev`（双终端）
 * - 然后启动 Electron 窗口
 *
 * 环境变量：
 * - VEC_ELECTRON_DEV_SAME_TERMINAL=1  不弹新窗口，在当前终端跑 dev（日志在本窗口）
 *
 * 一键同终端：npm run dev:desktop
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const devBase = process.env.VEC_DESKTOP_URL?.trim() || "http://localhost:3000";
const sameTerminal = process.env.VEC_ELECTRON_DEV_SAME_TERMINAL === "1";

/** @type {import("node:child_process").ChildProcess | null} */
let devChild = null;

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

async function spawnDevInNewConsole() {
  if (sameTerminal) {
    devChild = spawn(npmCmd, ["run", "dev"], {
      cwd: root,
      env: { ...process.env, VEC_DESKTOP_URL: devBase },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    console.log(
      "[electron-launch] 已在当前终端启动 npm run dev（VEC_ELECTRON_DEV_SAME_TERMINAL=1）。",
    );
    return;
  }

  if (process.platform === "win32") {
    const stateDir = path.join(root, ".agent-state");
    await fs.mkdir(stateDir, { recursive: true });
    const launcher = path.join(stateDir, "dev-server-launcher.cmd");
    await fs.writeFile(
      launcher,
      `@echo off\r\nchcp 65001 >nul\r\ncd /d "${root}"\r\necho [vec-next dev] %CD%\r\nnpm run dev\r\n`,
      "utf8",
    );

    // start 的第一个带引号参数是窗口标题；路径不要手写引号，交给 spawn 处理
    spawn("cmd.exe", ["/c", "start", "vec-next dev", "cmd", "/k", launcher], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    console.log(
      "[electron-launch] 已在新终端启动 npm run dev，请查看标题为「vec-next dev」的 CMD 窗口。",
    );
    return;
  }

  if (process.platform === "darwin") {
    spawn(
      "osascript",
      [
        "-e",
        `tell application "Terminal" to do script "cd '${root.replace(/'/g, "'\\''")}' && npm run dev"`,
      ],
      { detached: true, stdio: "ignore" },
    );
    console.log("[electron-launch] 已在 Terminal 中启动 npm run dev。");
    return;
  }

  devChild = spawn(npmCmd, ["run", "dev"], {
    cwd: root,
    env: { ...process.env, VEC_DESKTOP_URL: devBase },
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  console.log("[electron-launch] 已在后台启动 npm run dev。");
}

async function waitForServer(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let dots = 0;
  while (Date.now() < deadline) {
    if (await serverReady(base)) return true;
    dots = (dots + 1) % 4;
    process.stdout.write(`\r[electron-launch] 等待 Agent 服务${".".repeat(dots)}   `);
    await new Promise((r) => setTimeout(r, 800));
  }
  process.stdout.write("\n");
  return false;
}

function runElectron() {
  const child = spawn(npmCmd, ["run", "electron:raw"], {
    cwd: root,
    env: { ...process.env, VEC_DESKTOP_URL: devBase },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    if (devChild && !devChild.killed) {
      try {
        devChild.kill();
      } catch {
        // ignore
      }
    }
    process.exit(code ?? 0);
  });
}

async function main() {
  console.log("[electron-launch] Agent 地址:", devBase);

  if (!(await serverReady(devBase))) {
    console.log("[electron-launch] 未检测到 Agent 服务，正在启动 Next dev…");
    await spawnDevInNewConsole();
    const ready = await waitForServer(devBase);
    if (!ready) {
      console.error(
        `[electron-launch] ${devBase} 在 120s 内未就绪。\n` +
          "  请手动在新终端执行 npm run dev，或设置 VEC_ELECTRON_DEV_SAME_TERMINAL=1 在本终端启动。",
      );
      process.exit(1);
    }
    console.log("[electron-launch] Agent 服务已就绪。");
  }

  runElectron();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

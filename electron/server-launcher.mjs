import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

/**
 * 在打包应用内用 ELECTRON_RUN_AS_NODE 启动 Next standalone server。
 */
export async function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port =
        address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/agent/workspace`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

export async function startStandaloneServer(standaloneDir) {
  const serverEntry = path.join(standaloneDir, "server.js");
  const port = await findFreePort();
  const hostname = "127.0.0.1";

  const child = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: hostname,
      NODE_ENV: "production",
      VEC_DESKTOP_PACKAGED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = `http://${hostname}:${port}`;
  const ready = await waitForServer(baseUrl, 120_000);
  if (!ready) {
    child.kill();
    throw new Error(`Next standalone 未在 ${baseUrl} 就绪，请查看打包日志。`);
  }

  return { child, baseUrl, port };
}

export function stopStandaloneServer(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
        shell: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill();
  }
}

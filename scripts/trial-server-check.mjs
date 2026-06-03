/**
 * 检查 dev 服务是否就绪；可选继续跑 golden-path-ui dry-run。
 *
 *   npm run trial:server-check
 *   npm run trial:server-check -- --run-trial
 */
const BASE = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:3000";
const runTrial = process.argv.includes("--run-trial");

async function main() {
  console.log("trial-server-check:", BASE);
  const res = await fetch(`${BASE}/api/agent/workspace`, {
    signal: AbortSignal.timeout(8_000),
  }).catch((err) => {
    throw new Error(
      `无法连接 ${BASE}。请先 npm run dev。${err instanceof Error ? err.message : ""}`,
    );
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  console.log("  workspace ok:", data.workspace?.rootPath ?? "(cwd)");

  if (runTrial) {
    console.log("\n继续 golden-path-ui-trial (dry-run)…");
    const { spawn } = await import("node:child_process");
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["scripts/golden-path-ui-trial.mjs"],
        { stdio: "inherit", cwd: process.cwd(), shell: false },
      );
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`trial exit ${code}`)),
      );
    });
  } else {
    console.log("\n服务已就绪。完整在线试用：npm run trial:golden-path-ui");
  }

  console.log("\ntrial-server-check: PASSED");
}

main().catch((err) => {
  console.error("trial-server-check: FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

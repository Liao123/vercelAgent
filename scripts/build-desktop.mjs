/**
 * 桌面打包用 Next build（standalone）+ 资源复制。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCmd, args, {
      cwd: root,
      env: { ...process.env, BUILD_DESKTOP: "1" },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
    );
  });
}

async function main() {
  await run(["run", "build"]);
  const prep = spawn(process.execPath, ["scripts/prepare-electron-standalone.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    prep.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`prepare exit ${code}`)),
    );
  });
  console.log("build-desktop: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

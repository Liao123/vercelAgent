/**
 * 桌面便携包/安装包：先 build:desktop，再 electron-builder。
 * Windows 默认关闭代码签名探测，避免无证书环境打包失败。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const dirOnly = process.argv.includes("--dir");

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...process.env,
        ...extraEnv,
        ...(process.platform === "win32"
          ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
          : {}),
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
    );
  });
}

async function main() {
  await run(npmCmd, ["run", "build:desktop"]);

  const builderArgs = [
    "electron-builder",
    "--config",
    "electron-builder.yml",
    ...(dirOnly ? ["--dir"] : []),
  ];
  await run("npx", builderArgs);

  if (dirOnly) {
    console.log("pack-desktop: ok (unpacked -> dist-desktop/win-unpacked/)");
  } else {
    console.log("pack-desktop: ok (portable -> dist-desktop/)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * next build (output: standalone) 后复制 static / public 到 standalone 目录。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standalone = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standalone, ".next", "static");
const publicSrc = path.join(root, "public");
const publicDest = path.join(standalone, "public");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(path.join(standalone, "server.js")))) {
    throw new Error(
      "缺少 .next/standalone/server.js。请先运行 npm run build。",
    );
  }

  if (await exists(staticSrc)) {
    await fs.rm(staticDest, { recursive: true, force: true });
    await fs.cp(staticSrc, staticDest, { recursive: true });
    console.log("copied .next/static -> standalone/.next/static");
  } else {
    console.warn("warn: .next/static not found");
  }

  if (await exists(publicSrc)) {
    await fs.rm(publicDest, { recursive: true, force: true });
    await fs.cp(publicSrc, publicDest, { recursive: true });
    console.log("copied public -> standalone/public");
  }

  const envExample = path.join(root, ".env.example");
  if (await exists(envExample)) {
    await fs.copyFile(envExample, path.join(standalone, ".env.example"));
    console.log("copied .env.example -> standalone");
  }

  const envLocal = path.join(root, ".env.local");
  if (await exists(envLocal)) {
    await fs.copyFile(envLocal, path.join(standalone, ".env.local"));
    console.log("copied .env.local -> standalone (模型 API 配置)");
  } else {
    console.warn(
      "warn: 未找到 .env.local；打包后可用 UI「生成 .env.local 模板」或手动编辑 standalone/.env.local",
    );
  }

  console.log("prepare-electron-standalone: ok", standalone);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

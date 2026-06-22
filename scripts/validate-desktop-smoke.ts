/**
 * A025 桌面壳离线冒烟：聚合 electron / browser-desktop / desktop-setup 关键断言。
 *
 * 运行：npm run validate:desktop-smoke
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const pkg = JSON.parse(await read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const requiredScripts = [
    "electron",
    "dev:desktop",
    "build:desktop",
    "pack:desktop",
    "validate:electron-shell",
    "validate:browser-desktop",
    "validate:desktop-setup",
  ];
  for (const script of requiredScripts) {
    assert.ok(pkg.scripts?.[script], `missing npm script: ${script}`);
  }

  const main = await read("electron/main.mjs");
  const cdp = await read("electron/browser-cdp.mjs");
  const docs = await read("docs/agent-electron.md");

  assert.ok(main.includes("isPackaged"), "packaged mode in main");
  assert.ok(cdp.includes("Page.captureScreenshot"), "CDP screenshot");
  assert.ok(docs.includes("validate:browser-desktop"), "electron doc lists browser validate");
  assert.ok(docs.includes("选择文件夹"), "folder picker documented");

  console.log("validate-desktop-smoke: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

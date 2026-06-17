import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const main = await read("electron/main.mjs");
  assert.ok(main.includes("webviewTag: true"), "electron webviewTag");
  assert.ok(main.includes("sandbox: false"), "electron webview sandbox off");

  const panel = await read("src/components/browser-panel.tsx");
  assert.ok(panel.includes("BrowserWebview"), "browser panel webview");
  assert.ok(
    panel.includes("useDesktopApp") || panel.includes("isDesktopApp"),
    "browser panel desktop gate",
  );

  const webview = await read("src/components/browser-webview.tsx");
  assert.ok(
    webview.includes("/api/agent/browser/snapshot"),
    "webview posts snapshot",
  );
  assert.ok(
    webview.includes("console-message"),
    "webview listens for console messages",
  );
  assert.ok(
    webview.includes("browser-webview-probe"),
    "webview uses CDP-lite probe scripts",
  );

  const tools = await read("src/agent/core/agent-loop-tools.ts");
  assert.ok(tools.includes('"browser.inspect"'), "browser.inspect tool");

  const snapshotRoute = await read(
    "src/app/api/agent/browser/snapshot/route.ts",
  );
  assert.ok(
    snapshotRoute.includes("saveBrowserPageSnapshot"),
    "snapshot API",
  );

  const browserGet = await read("src/app/api/agent/browser/route.ts");
  assert.ok(
    browserGet.includes("getPersistedBrowserPageSnapshot"),
    "browser GET returns snapshot",
  );

  console.log("validate-browser-desktop: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

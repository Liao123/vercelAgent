import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  assert.ok(
    await fs
      .access(path.join(ROOT, "electron/browser-cdp.mjs"))
      .then(() => true)
      .catch(() => false),
    "electron/browser-cdp.mjs",
  );

  const mainSrc = await read("electron/main.mjs");
  const preload = await read("electron/preload.cjs");
  assert.ok(mainSrc.includes("webviewTag: true"), "electron webviewTag");
  assert.ok(mainSrc.includes("setupBrowserCdp"), "browser CDP setup");
  assert.ok(preload.includes("registerBrowserGuest"), "preload browser CDP");
  assert.ok(mainSrc.includes("sandbox: false"), "electron webview sandbox off");

  const panel = await read("src/components/browser-panel.tsx");
  assert.ok(panel.includes("BrowserWebview"), "browser panel webview");
  assert.ok(
    panel.includes("Codex 模式") || panel.includes("Codex 模式 · WebView"),
    "browser panel codex badge",
  );
  assert.ok(
    panel.includes("Search or enter URL"),
    "browser panel url placeholder",
  );
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
    webview.includes("captureBrowserScreenshotCdp"),
    "webview CDP screenshot",
  );
  assert.ok(
    webview.includes("console-message"),
    "webview listens for console messages",
  );
  assert.ok(
    webview.includes("browser-webview-probe"),
    "webview uses CDP-lite probe scripts",
  );
  assert.ok(
    webview.includes("BROWSER_HAR_COLLECT_SCRIPT"),
    "webview collects HAR-lite entries",
  );
  assert.ok(
    webview.includes("allowpopups=\"\""),
    "webview allowpopups attribute",
  );
  assert.ok(
    webview.includes("isIgnorableWebviewLoadError"),
    "webview ignores aborted navigation",
  );

  const harRoute = await read("src/app/api/agent/browser/har/route.ts");
  assert.ok(
    harRoute.includes("getPersistedBrowserHarLog"),
    "browser HAR GET API",
  );

  const tools = await read("src/agent/core/agent-loop-tools.ts");
  assert.ok(tools.includes('"browser.inspect"'), "browser.inspect tool");
  assert.ok(tools.includes('"browser.query"'), "browser.query tool");
  assert.ok(tools.includes("getPersistedBrowserHarLog"), "browser.inspect includes HAR");

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

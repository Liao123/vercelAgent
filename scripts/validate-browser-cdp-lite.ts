/**
 * A025 CDP-lite：WebView console / DOM 大纲 / 页面错误采集。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveBrowserPageSnapshot } from "../src/agent/browser/browser-snapshot";
import {
  BROWSER_DOM_OUTLINE_SCRIPT,
  BROWSER_PROBE_INJECT,
  mapWebviewConsoleLevel,
} from "../src/lib/browser-webview-probe";

async function main(): Promise<void> {
  assert.equal(mapWebviewConsoleLevel(3), "error");
  assert.equal(mapWebviewConsoleLevel(2), "warning");
  assert.equal(mapWebviewConsoleLevel(0), "debug");

  assert.ok(BROWSER_PROBE_INJECT.includes("__vecBrowserProbe"));
  assert.ok(BROWSER_DOM_OUTLINE_SCRIPT.includes("querySelectorAll"));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vec-browser-cdp-"));
  const prev = process.cwd();
  process.chdir(root);

  try {
    const saved = await saveBrowserPageSnapshot({
      url: "http://127.0.0.1:3000/",
      title: "test",
      textPreview: "hello",
      source: "webview",
      consoleMessages: [
        { level: "error", message: "boom", line: 1, sourceId: "app.js" },
      ],
      domOutline: "button: Submit",
      pageErrors: ["TypeError: x"],
      loadError: null,
    });
    assert.equal(saved.consoleMessages?.length, 1);
    assert.equal(saved.domOutline, "button: Submit");
    assert.equal(saved.pageErrors?.[0], "TypeError: x");

    const raw = await fs.readFile(
      path.join(root, ".agent-state/browser-snapshot.json"),
      "utf8",
    );
    assert.ok(raw.includes("consoleMessages"));
    assert.ok(raw.includes("domOutline"));
  } finally {
    process.chdir(prev);
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log("validate-browser-cdp-lite: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

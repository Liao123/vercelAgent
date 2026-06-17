/**
 * A025 CDP-lite：network/HAR + browser.query 队列 + 截图落盘。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getBrowserQueryResult,
  queueBrowserQuery,
  saveBrowserQueryResult,
  waitForBrowserQueryResult,
} from "../src/agent/browser/browser-query";
import {
  getPersistedBrowserHarLog,
  normalizeHarEntries,
} from "../src/agent/browser/browser-har";
import { saveBrowserPageSnapshot } from "../src/agent/browser/browser-snapshot";
import {
  BROWSER_HAR_COLLECT_SCRIPT,
  BROWSER_PROBE_INJECT,
  buildBrowserQueryScript,
  mapWebviewConsoleLevel,
} from "../src/lib/browser-webview-probe";

async function main(): Promise<void> {
  assert.equal(mapWebviewConsoleLevel(3), "error");
  assert.ok(BROWSER_PROBE_INJECT.includes("__vecBrowserProbe.network"));
  assert.ok(BROWSER_HAR_COLLECT_SCRIPT.includes("getEntriesByType"));
  assert.ok(buildBrowserQueryScript("button", 5).includes("querySelectorAll"));

  const normalized = normalizeHarEntries([
    {
      url: "http://127.0.0.1:3000/api/x",
      method: "GET",
      kind: "fetch",
      status: 404,
      durationMs: 12,
    },
    {
      url: "http://127.0.0.1:3000/api/x",
      method: "GET",
      kind: "fetch",
      status: 404,
      durationMs: 12,
    },
  ]);
  assert.equal(normalized.length, 1);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vec-browser-cdp-"));
  const prev = process.cwd();
  process.chdir(root);

  try {
    const saved = await saveBrowserPageSnapshot({
      url: "http://127.0.0.1:3000/",
      title: "test",
      textPreview: "hello",
      source: "webview",
      harEntries: [
        {
          url: "http://127.0.0.1:3000/api/x",
          method: "POST",
          kind: "fetch",
          status: 500,
          durationMs: 42,
          error: "HTTP 500",
        },
      ],
      screenshotJpegBase64: Buffer.from("fake-jpeg").toString("base64"),
      screenshotWidth: 800,
      screenshotHeight: 600,
    });
    assert.equal(saved.networkEvents?.length, 1);
    assert.ok(saved.harLog?.filePath.includes("browser-network.har.json"));
    assert.equal(saved.harLog?.entryCount, 1);
    assert.equal(saved.harLog?.failedCount, 1);
    assert.ok(saved.screenshot?.filePath.includes("browser-screenshot.jpg"));
    assert.ok(saved.screenshot!.bytes > 0);

    const har = await getPersistedBrowserHarLog();
    assert.equal(har?.entries.length, 1);
    assert.equal(har?.entries[0]?.method, "POST");

    const pending = await queueBrowserQuery({
      selector: "button.primary",
      maxResults: 8,
    });
    assert.equal(pending.selector, "button.primary");

    await saveBrowserQueryResult({
      selector: pending.selector,
      matches: [
        {
          tag: "button",
          id: "go",
          className: "primary",
          text: "Submit",
          rect: { x: 1, y: 2, w: 80, h: 32 },
        },
      ],
      completedAt: new Date().toISOString(),
      url: "http://127.0.0.1:3000/",
    });

    const result = await getBrowserQueryResult();
    assert.equal(result?.matches.length, 1);

    const waited = await waitForBrowserQueryResult({
      selector: pending.selector,
      queuedAt: "1970-01-01T00:00:00.000Z",
      timeoutMs: 100,
    });
    assert.ok(waited);
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

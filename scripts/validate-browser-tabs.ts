/**
 * A133：浏览器多标签 + devtools.list_pages / new_page / switch_page。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const tabs = await read("src/agent/browser/browser-tabs.ts");
  const panel = await read("src/components/browser-panel.tsx");
  const cdp = await read("electron/browser-cdp.mjs");
  const tools = await read("src/agent/core/agent-loop-tools.ts");
  const client = await read("src/agent/devtools/cdp-client.ts");

  assert.ok(tabs.includes("listBrowserPages"), "browser tabs list API");
  assert.ok(tabs.includes("switchBrowserTab"), "switch tab");
  assert.ok(tabs.includes("createBrowserTab"), "create tab");
  assert.ok(
    await fs
      .access(path.join(ROOT, "src/app/api/agent/browser/tabs/route.ts"))
      .then(() => true)
      .catch(() => false),
    "tabs API route",
  );

  assert.ok(panel.includes("switchTab"), "browser panel tab switch");
  assert.ok(
    panel.includes("openUrlInNewTab"),
    "internal links open sibling browser tab",
  );

  assert.ok(cdp.includes("listGuestPages"), "CDP list pages");
  assert.ok(cdp.includes("/pages"), "CDP /pages route");
  assert.ok(cdp.includes("/activate"), "CDP /activate route");

  assert.ok(tools.includes("devtools.list_pages"), "list_pages tool");
  assert.ok(tools.includes("devtools.new_page"), "new_page tool");
  assert.ok(tools.includes("devtools.switch_page"), "switch_page tool");

  assert.ok(client.includes("cdpListGuestPages"), "cdp client list pages");
  assert.ok(client.includes("cdpActivateGuest"), "cdp client activate");

  console.log("validate-browser-tabs: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

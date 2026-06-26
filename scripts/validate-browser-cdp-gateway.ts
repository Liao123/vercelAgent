/**
 * A130：CDP 网关与 devtools.* 工具静态验收。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

const DEVTOOLS_TOOLS = [
  "devtools.get_screenshot",
  "devtools.get_dom_snapshot",
  "devtools.get_accessibility_tree",
  "devtools.get_console_errors",
  "devtools.get_network_requests",
  "devtools.click",
  "devtools.type",
  "devtools.get_box_model",
  "devtools.get_computed_style",
  "devtools.inspect_element_at",
  "devtools.list_pages",
  "devtools.new_page",
  "devtools.switch_page",
  "devtools.performance_start_trace",
  "devtools.performance_stop_trace",
  "devtools.performance_analyze_insight",
  "devtools.extract_design_spec",
  "devtools.get_persisted_design_spec",
];

async function main(): Promise<void> {
  const cdpMain = await read("electron/browser-cdp.mjs");
  assert.ok(cdpMain.includes("startCdpBridgeServer"), "CDP HTTP bridge");
  assert.ok(cdpMain.includes("/send"), "bridge /send");
  assert.ok(cdpMain.includes("captureGuestScreenshot"), "full page screenshot");
  assert.ok(cdpMain.includes("captureUrlInHiddenWindow"), "hidden capture window");
  assert.ok(cdpMain.includes("useCaptureWindow"), "capture window API");
  assert.ok(cdpMain.includes("captureBeyondViewport"), "CDP beyond viewport");
  assert.ok(cdpMain.includes("/type"), "bridge /type");
  assert.ok(cdpMain.includes("DOMSnapshot.captureSnapshot"), "DOM snapshot CDP");
  assert.ok(cdpMain.includes("Accessibility.getFullAXTree"), "AX tree CDP");
  assert.ok(cdpMain.includes("listGuestPages"), "CDP list guest pages");
  assert.ok(cdpMain.includes("/pages"), "bridge /pages");
  assert.ok(cdpMain.includes("/activate"), "bridge /activate");

  const preload = await read("electron/preload.cjs");
  assert.ok(preload.includes("sendBrowserCdp"), "preload sendBrowserCdp");
  assert.ok(preload.includes("getCdpBridgeUrl"), "preload bridge url");

  const tools = await read("src/agent/core/agent-loop-tools.ts");
  for (const name of DEVTOOLS_TOOLS) {
    assert.ok(tools.includes(`"${name}"`), `tool ${name}`);
  }

  assert.ok(
    await fs
      .access(path.join(ROOT, "src/agent/devtools/cdp-client.ts"))
      .then(() => true)
      .catch(() => false),
    "cdp-client.ts",
  );

  assert.ok(
    await fs
      .access(path.join(ROOT, "src/app/api/agent/browser/cdp/guest/route.ts"))
      .then(() => true)
      .catch(() => false),
    "cdp guest API",
  );

  console.log("validate-browser-cdp-gateway: passed", {
    devtoolsToolCount: DEVTOOLS_TOOLS.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

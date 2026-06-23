import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const panel = await read("src/components/agent-panel.tsx");
  const prefs = await read("src/lib/triple-layout-prefs.ts");
  const handle = await read("src/components/triple-layout-resize-handle.tsx");

  assert.ok(prefs.includes("readTripleLayoutPrefs"), "triple layout prefs");
  assert.ok(handle.includes("TripleLayoutResizeHandle"), "resize handle");
  assert.ok(panel.includes("TripleLayoutResizeHandle"), "panel wires resize");
  assert.ok(panel.includes("tripleLeftWidth"), "left column width state");
  assert.ok(panel.includes("tripleRightWidth"), "right column width state");
  assert.ok(panel.includes("tripleRightCollapsed"), "right column collapse state");
  assert.ok(panel.includes("onHideRightPanel"), "right rail hide button wired");
  assert.ok(!panel.includes("w-56 shrink-0"), "fixed left width removed");

  console.log("validate-triple-layout-resize: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

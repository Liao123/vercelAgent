/**
 * A024 demo-replicate 页面实机验收（需 dev）。
 *
 * 运行：npm run validate:demo-replicate-page
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

async function main(): Promise<void> {
  const source = await fs.readFile("src/app/demo-replicate/page.tsx", "utf8");
  assert.ok(source.includes("Example Domain"), "page source has title");
  assert.ok(source.includes("More information"), "page source has link text");
  assert.ok(
    !source.includes("占位页"),
    "placeholder copy should be replaced",
  );

  const res = await fetch(`${BASE}/demo-replicate`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  assert.ok(res?.ok, `无法访问 ${BASE}/demo-replicate，请先 npm run dev`);

  const html = await res!.text();
  assert.ok(html.includes("Example Domain"), "rendered title");
  assert.ok(html.includes("illustrative examples"), "rendered body");
  assert.ok(html.includes("More information"), "rendered link");

  console.log("validate-demo-replicate-page: passed", { base: BASE });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

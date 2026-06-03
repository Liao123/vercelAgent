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
  assert.ok(
    pkg.scripts?.["pack:desktop"]?.includes("pack-desktop.mjs"),
    "pack:desktop uses pack-desktop.mjs",
  );

  const prep = await read("scripts/prepare-electron-standalone.mjs");
  assert.ok(prep.includes(".env.example"), "standalone ships .env.example");

  const launcher = await read("electron/server-launcher.mjs");
  assert.ok(
    launcher.includes("VEC_DESKTOP_PACKAGED"),
    "packaged server env flag",
  );

  const main = await read("electron/main.mjs");
  assert.ok(main.includes("desktop:open-config-dir"), "open config IPC");

  const preload = await read("electron/preload.cjs");
  assert.ok(preload.includes("openConfigDirectory"), "preload openConfigDirectory");

  const route = await read("src/app/api/agent/desktop/setup/route.ts");
  assert.ok(route.includes("seedDesktopEnvLocalFromExample"), "setup API");

  const banner = await read("src/components/desktop-setup-banner.tsx");
  assert.ok(banner.includes("DesktopSetupBanner"), "setup banner");
  assert.ok(banner.includes("seed-env"), "setup banner seeds env");
  assert.ok(banner.includes("重新加载"), "setup banner reload hint");
  assert.ok(
    (await read("src/components/agent-workspace.tsx")).includes(
      "DesktopSetupBanner",
    ),
    "workspace wires banner",
  );

  console.log("validate-desktop-setup: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

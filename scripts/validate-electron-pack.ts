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
    devDependencies?: Record<string, string>;
  };
  const nextConfig = await read("next.config.ts");
  const builder = await read("electron-builder.yml");

  assert.ok(pkg.scripts?.["build:desktop"], "build:desktop script");
  assert.ok(pkg.scripts?.["pack:desktop"], "pack:desktop script");
  assert.ok(pkg.scripts?.["pack:desktop:dir"], "pack:desktop:dir script");
  assert.ok(
    pkg.scripts?.["pack:desktop"]?.includes("pack-desktop.mjs"),
    "pack:desktop wrapper",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "scripts/pack-desktop.mjs"))
      .then(() => true)
      .catch(() => false),
    "pack-desktop.mjs present",
  );
  assert.ok(pkg.devDependencies?.["electron-builder"], "electron-builder dep");
  assert.ok(
    nextConfig.includes("BUILD_DESKTOP") && pkg.scripts?.["build:desktop"]?.includes("build-desktop.mjs"),
    "conditional standalone build",
  );
  assert.ok(builder.includes("standalone"), "extraResources standalone");
  assert.ok(
    await fs
      .access(path.join(ROOT, "electron/server-launcher.mjs"))
      .then(() => true)
      .catch(() => false),
    "server-launcher present",
  );

  console.log("validate-electron-pack: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

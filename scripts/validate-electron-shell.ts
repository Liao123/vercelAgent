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

  assert.ok(pkg.scripts?.electron, "missing npm run electron");
  assert.ok(pkg.scripts?.["dev:desktop"], "missing npm run dev:desktop");
  assert.ok(
    await fs
      .access(path.join(ROOT, "electron/main.mjs"))
      .then(() => true)
      .catch(() => false),
    "electron/main.mjs missing",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "electron/preload.cjs"))
      .then(() => true)
      .catch(() => false),
    "electron/preload.cjs missing",
  );

  const panel = await read("src/components/agent-panel.tsx");
  const bridge = await read("src/lib/desktop-bridge.ts");
  assert.ok(bridge.includes("pickWorkspaceFolder"), "desktop bridge");
  assert.ok(panel.includes("handlePickWorkspaceFolder"), "panel pick folder");
  assert.ok(
    panel.includes("打开文件夹") || panel.includes("pickWorkspaceFolder"),
    "pick folder button label",
  );

  const workspace = await read("src/components/agent-workspace.tsx");
  assert.ok(workspace.includes("AgentDevDevelopPanel"), "dev develop panel wired");

  const main = await read("electron/main.mjs");
  assert.ok(main.includes("isPackaged"), "packaged desktop mode");
  assert.ok(
    await fs
      .access(path.join(ROOT, "electron/server-launcher.mjs"))
      .then(() => true)
      .catch(() => false),
    "server-launcher.mjs",
  );

  console.log("validate-electron-shell: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

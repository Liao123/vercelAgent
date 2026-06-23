import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveFilePathArg,
  resolveUserDesktopDir,
  resolveUserSavePath,
} from "../src/lib/user-path.ts";

async function main(): Promise<void> {
  const home = os.homedir();
  const desktop = resolveUserDesktopDir();
  assert.ok(path.isAbsolute(desktop), "desktop dir is absolute");
  assert.ok(
    desktop.includes(home) ||
      desktop.includes("Desktop") ||
      desktop.includes("桌面"),
  );

  const fromTilde = resolveUserSavePath("~/Desktop/trial-shot.jpg");
  assert.ok(path.isAbsolute(fromTilde));
  assert.ok(fromTilde.endsWith("trial-shot.jpg"));

  const fromAlias = resolveUserSavePath("desktop:capture.png");
  assert.ok(path.isAbsolute(fromAlias));
  assert.ok(fromAlias.includes(path.basename(desktop)));

  const resolved = resolveFilePathArg({
    filePath: "desktop:test.png",
    format: "png",
  });
  assert.equal(resolved.format, "png");
  assert.ok(
    typeof resolved.filePath === "string" &&
      path.isAbsolute(resolved.filePath as string),
  );

  const nativePrompt = await fs.readFile(
    "src/agent/prompts/loop-system-native.md",
    "utf8",
  );
  assert.ok(
    !nativePrompt.includes("DESKTOP_HINT"),
    "no per-user desktop injection in prompt",
  );
  assert.ok(
    nativePrompt.includes("desktop:name.png") ||
      nativePrompt.includes("~/Desktop"),
    "generic save path hints in prompt",
  );

  console.log("validate-user-path: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

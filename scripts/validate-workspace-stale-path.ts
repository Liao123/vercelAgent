/**
 * A162：失效 workspace 路径不回退时不得 500。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isWorkspaceDirectory,
  resolveWorkspaceRootPath,
} from "../src/agent/workspace/workspace-config";
import { readProjectRules } from "../src/agent/tools/project-rules";

async function main(): Promise<void> {
  const configSrc = fs.readFileSync(
    path.join(process.cwd(), "src/agent/workspace/workspace-config.ts"),
    "utf8",
  );
  const managerSrc = fs.readFileSync(
    path.join(process.cwd(), "src/agent/workspace/workspace-manager.ts"),
    "utf8",
  );
  const rulesSrc = fs.readFileSync(
    path.join(process.cwd(), "src/agent/tools/project-rules.ts"),
    "utf8",
  );

  assert.ok(configSrc.includes("resolveWorkspaceRootPath"), "resolver exported");
  assert.ok(configSrc.includes("staleConfiguredPath"), "stale path signal");
  assert.ok(managerSrc.includes("resolveWorkspaceRootPath"), "manager uses resolver");
  assert.ok(managerSrc.includes("staleConfiguredPath"), "workspace info exposes stale");
  assert.ok(rulesSrc.includes("ENOENT"), "project-rules tolerates missing dirs");

  const cwd = process.cwd();
  assert.equal(await isWorkspaceDirectory(cwd), true);
  assert.equal(
    await isWorkspaceDirectory(path.join(cwd, "__no_such_workspace__")),
    false,
  );

  const rules = await readProjectRules(path.join(cwd, "__no_such_workspace__"));
  assert.deepEqual(rules, [], "missing root yields empty rules, not throw");

  const resolved = await resolveWorkspaceRootPath();
  assert.ok(resolved.rootPath, "always resolves a root path");
  assert.ok(await isWorkspaceDirectory(resolved.rootPath), "resolved path is directory");

  console.log("validate-workspace-stale-path: passed", {
    rootPath: resolved.rootPath,
    staleConfiguredPath: resolved.staleConfiguredPath,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

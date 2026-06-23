/**
 * 工作区结构事实（只观测、不门禁）。
 *
 * 运行：npm run validate:workspace-structure-facts
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectWorkspaceStructureFacts,
  formatWorkspaceStructureFactsForPrompt,
} from "../src/agent/workspace/workspace-structure-facts";
import type { WorkspaceInfo } from "../src/agent/workspace/workspace-manager";

function baseWorkspace(rootPath: string): WorkspaceInfo {
  return {
    id: "ws_test",
    rootPath,
    gitRootPath: null,
    packageManager: "unknown",
    framework: null,
    packageName: null,
    rules: [],
    git: null,
    staleConfiguredPath: null,
  };
}

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vec-ws-structure-"));
  const empty = await collectWorkspaceStructureFacts(baseWorkspace(tmp));
  assert.equal(empty.hasPackageJson, false);
  assert.ok(empty.observations.some((item) => item.includes("package.json")));
  assert.ok(
    formatWorkspaceStructureFactsForPrompt(empty).includes("derive prerequisites"),
  );

  const stale = await collectWorkspaceStructureFacts({
    ...baseWorkspace(tmp),
    staleConfiguredPath: "D:\\missing\\project",
  });
  assert.ok(stale.observations.some((item) => item.includes("workspace.json")));

  const good = path.join(tmp, "good-next");
  await fs.mkdir(path.join(good, "src", "app"), { recursive: true });
  await fs.writeFile(path.join(good, "package.json"), '{"name":"good"}', "utf8");
  const goodFacts = await collectWorkspaceStructureFacts(baseWorkspace(good));
  assert.equal(goodFacts.hasPackageJson, true);
  assert.equal(goodFacts.hasSrcApp, true);
  assert.equal(goodFacts.observations.length, 0);

  const cwdFacts = await collectWorkspaceStructureFacts(baseWorkspace(process.cwd()));
  assert.equal(cwdFacts.hasPackageJson, true);

  console.log("validate-workspace-structure-facts: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

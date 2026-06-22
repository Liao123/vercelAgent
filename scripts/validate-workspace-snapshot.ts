/**
 * A147：Workspace 快照零成本注入 smoke。
 *
 * 运行：npm run validate:workspace-snapshot
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createLoopSystemPrompt } from "../src/agent/prompts/create-loop-system-prompt";
import { loadPromptFile } from "../src/agent/prompts/load-prompt";
import {
  formatWorkspaceSnapshotForPrompt,
  workspaceToSnapshotInput,
} from "../src/agent/workspace/workspace-snapshot-prompt";
import { getCurrentWorkspace } from "../src/agent/workspace/workspace-manager";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const loop = await read("src/agent/core/agent-loop.ts");
  const nativeTemplate = loadPromptFile("loop-system-native.md");
  const jsonTemplate = loadPromptFile("loop-system.md");

  assert.ok(loop.includes("workspaceToSnapshotInput"), "loop builds snapshot");
  assert.ok(
    loop.includes("createLoopSystemPrompt") &&
      loop.includes("workspaceSnapshot"),
    "loop passes snapshot to system prompt",
  );
  assert.ok(nativeTemplate.includes("{{WORKSPACE_SNAPSHOT}}"));
  assert.ok(jsonTemplate.includes("{{WORKSPACE_SNAPSHOT}}"));

  const workspace = await getCurrentWorkspace();
  const snapshot = workspaceToSnapshotInput(workspace);
  const block = formatWorkspaceSnapshotForPrompt(snapshot);

  assert.ok(block.includes("[WORKSPACE_SNAPSHOT"));
  assert.ok(block.includes("NOT proof for edits"));
  assert.ok(block.includes("do NOT call workspace.inspect only"));
  assert.ok(block.includes(workspace.rootPath));
  if (workspace.framework) {
    assert.ok(block.includes(workspace.framework));
  }
  if (workspace.packageName) {
    assert.ok(block.includes(workspace.packageName));
  }

  const prompt = createLoopSystemPrompt(
    workspace.rootPath,
    { layout: "triple", activeRoute: "/" },
    snapshot,
  );
  assert.ok(prompt.includes("[WORKSPACE_SNAPSHOT"));
  assert.ok(!prompt.includes("{{WORKSPACE_SNAPSHOT}}"));
  if (workspace.framework) {
    assert.ok(prompt.includes(`Detected framework: ${workspace.framework}`));
  }

  console.log("validate-workspace-snapshot: passed");
}

main().catch((error) => {
  console.error("validate-workspace-snapshot failed:", error);
  process.exit(1);
});

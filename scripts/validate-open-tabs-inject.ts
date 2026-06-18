/**
 * A117：open tabs / 焦点文件注入 system prompt。
 *
 * 运行：npm run validate:open-tabs-inject
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildOpenEditorUiContext,
  describeUiContextForPrompt,
} from "../src/agent/indexer/ui-layout-boost";
import { createLoopSystemPrompt } from "../src/agent/prompts/create-loop-system-prompt";

const PANEL_PATH = "src/components/agent-panel.tsx";

async function main(): Promise<void> {
  const ctx = buildOpenEditorUiContext({
    layout: "triple",
    attachedPaths: [PANEL_PATH, "src/components/agent-composer.tsx"],
    activeEditorPath: PANEL_PATH,
  });

  assert.deepEqual(ctx.openEditorPaths, [
    PANEL_PATH,
    "src/components/agent-composer.tsx",
  ]);
  assert.equal(ctx.activeEditorPath, PANEL_PATH);

  const block = describeUiContextForPrompt(ctx);
  assert.ok(block.includes("Open editor files"), "prompt block should list open tabs");
  assert.ok(block.includes(PANEL_PATH));
  assert.ok(block.includes("Active editor file"));

  const empty = buildOpenEditorUiContext({ layout: "workspace" });
  assert.equal(empty.openEditorPaths, undefined);
  assert.equal(describeUiContextForPrompt(empty).includes("Open editor files"), false);

  const systemPrompt = createLoopSystemPrompt(process.cwd(), ctx);
  assert.ok(systemPrompt.includes("Open editor files"));
  assert.ok(systemPrompt.includes("Active editor file"));

  const panel = await fs.readFile(path.join(process.cwd(), PANEL_PATH), "utf8");
  assert.ok(
    panel.includes("buildOpenEditorUiContext"),
    "agent-panel should wire buildOpenEditorUiContext into loop POST",
  );

  console.log("validate-open-tabs-inject: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

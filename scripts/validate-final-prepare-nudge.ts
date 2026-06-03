/**
 * A087：末轮 prepare 助推触发条件（无需 LLM）。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildFinalPrepareNudgeUserMessage,
  hasAttemptedPrepareTool,
  shouldRunFinalPrepareNudge,
} from "../src/agent/core/final-prepare-nudge";
import {
  createAgentLoopRunState,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import { captureUiPrepareHintFromFileRead } from "../src/agent/core/ui-prepare-nudge";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";

const COMPOSER = "src/components/agent-composer.tsx";
const PANEL = "src/components/agent-panel.tsx";

async function main(): Promise<void> {
  const content = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), COMPOSER),
    "utf8",
  );
  const panelContent = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), PANEL),
    "utf8",
  );

  const state = createAgentLoopRunState("把首页左边的闭环/Loop 选择去掉");
  state.toolsCalled.push("ui.trace_from_page");
  state.disambiguation = {
    label: "闭环",
    mustReadPaths: [COMPOSER, PANEL],
    recommendedPath: COMPOSER,
    selectionRationale: "triple → composer",
  };
  recordToolCall(state, "file.read", { path: COMPOSER, content });
  recordToolCall(state, "file.read", { path: PANEL, content: panelContent });
  captureUiPrepareHintFromFileRead(
    state,
    COMPOSER,
    content,
    { layout: "triple" },
  );

  assert.ok(shouldRunFinalPrepareNudge(state, { layout: "triple" }));
  assert.ok(buildFinalPrepareNudgeUserMessage(state)?.includes("Final prepare round"));

  recordToolCall(state, "file.replace.prepare", { error: "search not found" });
  assert.ok(hasAttemptedPrepareTool(state));
  assert.equal(shouldRunFinalPrepareNudge(state, { layout: "triple" }), false);

  console.log("validate-final-prepare-nudge: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

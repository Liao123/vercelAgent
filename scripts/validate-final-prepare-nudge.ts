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
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

async function main(): Promise<void> {
  process.env.AGENT_FINAL_PREPARE_NUDGE = "1";
  const content = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), SIDEBAR_PATH),
    "utf8",
  );
  const panelContent = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), PANEL_PATH),
    "utf8",
  );

  const state = createAgentLoopRunState(GOLDEN_UI_QUERY);
  state.toolsCalled.push("file.locate");
  state.disambiguation = {
    label: GOLDEN_DISAMBIGUATION_LABEL,
    mustReadPaths: [SIDEBAR_PATH, PANEL_PATH],
    recommendedPath: SIDEBAR_PATH,
    selectionRationale: "sidebar plus intent",
  };
  recordToolCall(state, "file.read", { path: SIDEBAR_PATH, content });
  recordToolCall(state, "file.read", { path: PANEL_PATH, content: panelContent });
  captureUiPrepareHintFromFileRead(
    state,
    SIDEBAR_PATH,
    content,
    GOLDEN_UI_CONTEXT,
  );

  assert.ok(shouldRunFinalPrepareNudge(state, GOLDEN_UI_CONTEXT));
  assert.ok(buildFinalPrepareNudgeUserMessage(state)?.includes("Final prepare round"));

  recordToolCall(state, "file.replace.prepare", { error: "search not found" });
  assert.ok(hasAttemptedPrepareTool(state));
  assert.equal(shouldRunFinalPrepareNudge(state, GOLDEN_UI_CONTEXT), false);

  console.log("validate-final-prepare-nudge: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

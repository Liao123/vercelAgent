/**
 * A085：消歧未读完时不推 prepare nudge，只推先 file.read 候选。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildRuntimeCheckpoint,
  createAgentLoopRunState,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import {
  buildUiDisambiguationReadNudgeBlock,
  buildUiPrepareNudgeBlock,
  captureUiPrepareHintFromFileRead,
} from "../src/agent/core/ui-prepare-nudge";
import {
  buildStructuredCompactedMemory,
  parseCompactedMemory,
} from "../src/agent/memory/loop-context-compactor";
import { emptyPinnedFacts } from "../src/agent/memory/loop-pinned-facts";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

async function main(): Promise<void> {
  const content = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), SIDEBAR_PATH),
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
  captureUiPrepareHintFromFileRead(
    state,
    SIDEBAR_PATH,
    content,
    GOLDEN_UI_CONTEXT,
  );

  assert.ok(state.prepareHint, "internal prepareHint after sidebar read");
  assert.equal(buildUiPrepareNudgeBlock(state), null, "no prepare nudge until panel read");
  assert.ok(
    buildUiDisambiguationReadNudgeBlock(state)?.includes(PANEL_PATH),
    "disambiguation nudge should list unread panel",
  );

  const checkpoint = buildRuntimeCheckpoint(state);
  assert.ok(checkpoint.includes("read all candidates first"));
  assert.ok(!checkpoint.includes("UI prepare nudge"));

  recordToolCall(state, "file.read", { path: PANEL_PATH, content: "// panel stub\n" });
  assert.ok(buildUiPrepareNudgeBlock(state), "prepare nudge after all candidates read");
  assert.equal(buildUiDisambiguationReadNudgeBlock(state), null);

  const memory = buildStructuredCompactedMemory({
    round: 1,
    method: "deterministic",
    pinnedFacts: emptyPinnedFacts(),
    summaryBody: "prior UI task",
    changedFiles: [SIDEBAR_PATH],
    pinnedPrepareHint: state.prepareHint,
  });
  const parsed = parseCompactedMemory(memory);
  assert.equal(parsed?.pinnedPrepareHint?.path, SIDEBAR_PATH);

  console.log("validate-disambiguation-prepare-nudge: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

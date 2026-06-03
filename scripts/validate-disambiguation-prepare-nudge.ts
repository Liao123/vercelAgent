/**
 * A085：消歧未读完时不推 prepare nudge，只推先 file.read 候选。
 *
 * 运行：npm run validate:disambiguation-prepare-nudge
 */
import assert from "node:assert/strict";
import { buildRuntimeCheckpoint, createAgentLoopRunState, recordToolCall } from "../src/agent/core/agent-loop-state";
import {
  buildUiDisambiguationReadNudgeBlock,
  buildUiPrepareNudgeBlock,
  captureUiPrepareHintFromFileRead,
} from "../src/agent/core/ui-prepare-nudge";
import { parseCompactedMemory } from "../src/agent/memory/loop-context-compactor";
import { buildStructuredCompactedMemory } from "../src/agent/memory/loop-context-compactor";
import { emptyPinnedFacts } from "../src/agent/memory/loop-pinned-facts";
import fs from "node:fs/promises";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";

const COMPOSER = "src/components/agent-composer.tsx";
const PANEL = "src/components/agent-panel.tsx";

async function main(): Promise<void> {
  const content = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), COMPOSER),
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
  captureUiPrepareHintFromFileRead(
    state,
    COMPOSER,
    content,
    { layout: "triple" },
  );

  assert.ok(state.prepareHint, "internal prepareHint after composer read");
  assert.equal(buildUiPrepareNudgeBlock(state), null, "no prepare nudge until panel read");
  assert.ok(
    buildUiDisambiguationReadNudgeBlock(state)?.includes(PANEL),
    "disambiguation nudge should list unread panel",
  );

  const checkpoint = buildRuntimeCheckpoint(state);
  assert.ok(checkpoint.includes("read all candidates first"));
  assert.ok(!checkpoint.includes("UI prepare nudge"));

  recordToolCall(state, "file.read", { path: PANEL, content: "// panel stub\n" });
  assert.ok(buildUiPrepareNudgeBlock(state), "prepare nudge after all candidates read");
  assert.equal(buildUiDisambiguationReadNudgeBlock(state), null);

  const memory = buildStructuredCompactedMemory({
    round: 1,
    method: "deterministic",
    pinnedFacts: emptyPinnedFacts(),
    summaryBody: "prior UI task",
    changedFiles: [COMPOSER],
    pinnedPrepareHint: state.prepareHint,
  });
  const parsed = parseCompactedMemory(memory);
  assert.equal(parsed?.pinnedPrepareHint?.path, COMPOSER);

  console.log("validate-disambiguation-prepare-nudge: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

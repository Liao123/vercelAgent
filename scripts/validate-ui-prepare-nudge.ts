/**
 * A083：UI prepare nudge（无需 LLM）。
 */
import fs from "node:fs/promises";
import {
  createAgentLoopRunState,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import {
  buildUiPrepareNudgeBlock,
  captureUiPrepareHintFromFileRead,
  extractUiLabelSearchCandidates,
  isUiPrepareEvidenceReady,
  shouldSkipEditRecoveryForUiPrepare,
} from "../src/agent/core/ui-prepare-nudge";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
  SIDEBAR_PLUS_LINE,
} from "./golden-path-fixtures";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const sidebarContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, SIDEBAR_PATH),
    "utf8",
  );

  const candidates = extractUiLabelSearchCandidates(sidebarContent, [
    "新建 Agent",
  ]);
  assert(candidates.length >= 1, "should find sidebar JSX lines");
  assert(
    candidates.some((line) => line.includes("+") || line.includes("新建 Agent")),
    "candidates should include plus or 新建 Agent labels",
  );

  const state = createAgentLoopRunState(GOLDEN_UI_QUERY);
  state.toolsCalled.push("file.locate");
  state.disambiguation = {
    label: GOLDEN_DISAMBIGUATION_LABEL,
    mustReadPaths: [SIDEBAR_PATH, PANEL_PATH],
    recommendedPath: SIDEBAR_PATH,
    selectionRationale: "sidebar plus intent",
  };
  const panelContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, PANEL_PATH),
    "utf8",
  );
  recordToolCall(state, "file.read", { path: SIDEBAR_PATH, content: sidebarContent });
  recordToolCall(state, "file.read", { path: PANEL_PATH, content: panelContent });
  captureUiPrepareHintFromFileRead(
    state,
    SIDEBAR_PATH,
    sidebarContent,
    GOLDEN_UI_CONTEXT,
  );

  assert(state.prepareHint?.path === SIDEBAR_PATH, "prepareHint path");
  assert(
    state.prepareHint?.suggestedSearchLines.some((line) =>
      line.includes("+"),
    ),
    "prepareHint should include plus line candidate",
  );
  assert(
    isUiPrepareEvidenceReady(state, GOLDEN_UI_CONTEXT),
    "UI prepare evidence should be ready",
  );
  assert(
    !shouldSkipEditRecoveryForUiPrepare(state, GOLDEN_UI_CONTEXT),
    "edit recovery removed — always false",
  );
  state.toolsCalled.push("file.replace.prepare");
  assert(
    !shouldSkipEditRecoveryForUiPrepare(state, GOLDEN_UI_CONTEXT),
    "edit recovery still disabled after prepare",
  );
  state.toolsCalled.pop();

  const nudge = buildUiPrepareNudgeBlock(state);
  assert(nudge?.includes("file.replace search"), "nudge should mention prepare search");
  assert(nudge?.includes("Candidate 1"), "nudge should list candidates");
  assert(
    sidebarContent.includes(SIDEBAR_PLUS_LINE),
    "fixture plus line should exist on disk",
  );

  console.log("validate-ui-prepare-nudge: passed", {
    candidateCount: candidates.length,
    firstCandidate: candidates[0]?.slice(0, 60),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

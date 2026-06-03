/**
 * A083：UI prepare nudge + recovery 跳过逻辑（无需 LLM）。
 *
 * 运行：npm run validate:ui-prepare-nudge
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

const COMPOSER = "src/components/agent-composer.tsx";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const content = await fs.readFile(
    resolveInsideWorkspace(rootPath, COMPOSER),
    "utf8",
  );

  const candidates = extractUiLabelSearchCandidates(content);
  assert(candidates.length >= 1, "should find Loop/闭环 JSX lines");
  assert(
    candidates.some((line) => line.includes("Loop") || line.includes("闭环")),
    "candidates should include RunMode labels",
  );

  const state = createAgentLoopRunState("把首页左边的闭环/Loop 选择去掉");
  state.toolsCalled.push("ui.trace_from_page");
  state.disambiguation = {
    label: "闭环",
    mustReadPaths: [COMPOSER, "src/components/agent-panel.tsx"],
    recommendedPath: COMPOSER,
    selectionRationale: "triple → composer",
  };
  const panelPath = "src/components/agent-panel.tsx";
  const panelContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, panelPath),
    "utf8",
  );
  recordToolCall(state, "file.read", { path: COMPOSER, content });
  recordToolCall(state, "file.read", { path: panelPath, content: panelContent });
  captureUiPrepareHintFromFileRead(
    state,
    COMPOSER,
    content,
    { layout: "triple", activeRoute: "/" },
  );

  assert(state.prepareHint?.path === COMPOSER, "prepareHint path");
  assert(
    isUiPrepareEvidenceReady(state, { layout: "triple" }),
    "UI prepare evidence should be ready",
  );
  assert(
    !shouldSkipEditRecoveryForUiPrepare(state, { layout: "triple" }),
    "recovery allowed before first prepare attempt",
  );
  state.toolsCalled.push("file.replace.prepare");
  assert(
    shouldSkipEditRecoveryForUiPrepare(state, { layout: "triple" }),
    "recovery skipped after prepare attempted with evidence ready",
  );
  state.toolsCalled.pop();

  const nudge = buildUiPrepareNudgeBlock(state);
  assert(nudge?.includes("file.replace.prepare"), "nudge should mention prepare");
  assert(nudge?.includes("Candidate 1"), "nudge should list candidates");

  console.log("validate-ui-prepare-nudge: passed", {
    candidateCount: candidates.length,
    firstCandidate: candidates[0]?.slice(0, 60),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

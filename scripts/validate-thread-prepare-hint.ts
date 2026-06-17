/**
 * A085：延续会话时从 thread 滚动记忆恢复 prepareHint。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createAgentLoopRunState,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import { captureUiPrepareHintFromFileRead } from "../src/agent/core/ui-prepare-nudge";
import { isUiLocationQuery } from "../src/agent/core/prepare-gate";
import {
  buildStructuredCompactedMemory,
  parseCompactedMemory,
} from "../src/agent/memory/loop-context-compactor";
import { emptyPinnedFacts } from "../src/agent/memory/loop-pinned-facts";
import { buildThreadMemoryInjectionMessage } from "../src/agent/memory/thread-memory-store";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";
import {
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

const USER_REQUEST = `继续：${GOLDEN_UI_QUERY}`;

function restorePrepareHintFromThreadMemory(
  runState: ReturnType<typeof createAgentLoopRunState>,
  memoryContent: string,
  userRequest: string,
): void {
  const priorMemory = parseCompactedMemory(memoryContent);
  if (
    priorMemory?.pinnedPrepareHint &&
    runState.likelyEditRequest &&
    !runState.approvalPrepared &&
    isUiLocationQuery(userRequest)
  ) {
    runState.prepareHint = priorMemory.pinnedPrepareHint;
  }
}

async function main(): Promise<void> {
  const content = await fs.readFile(
    resolveInsideWorkspace(process.cwd(), SIDEBAR_PATH),
    "utf8",
  );

  const runState = createAgentLoopRunState(USER_REQUEST);
  runState.disambiguation = {
    label: "新建 Agent",
    mustReadPaths: [SIDEBAR_PATH],
    recommendedPath: SIDEBAR_PATH,
    selectionRationale: "sidebar plus intent",
  };
  recordToolCall(runState, "file.read", { path: SIDEBAR_PATH, content });
  captureUiPrepareHintFromFileRead(
    runState,
    SIDEBAR_PATH,
    content,
    GOLDEN_UI_CONTEXT,
  );
  assert.ok(runState.prepareHint);

  const memoryContent = buildStructuredCompactedMemory({
    round: 2,
    method: "deterministic",
    pinnedFacts: emptyPinnedFacts(),
    summaryBody: "Task1: traced sidebar, have prepare candidates",
    changedFiles: [SIDEBAR_PATH],
    pinnedPrepareHint: runState.prepareHint,
  });

  const freshState = createAgentLoopRunState(USER_REQUEST);
  assert.equal(freshState.prepareHint, undefined);

  restorePrepareHintFromThreadMemory(freshState, memoryContent, USER_REQUEST);
  assert.equal(freshState.prepareHint?.path, SIDEBAR_PATH);
  assert.ok(
    (freshState.prepareHint?.suggestedSearchLines.length ?? 0) >= 1,
  );

  const injection = buildThreadMemoryInjectionMessage(memoryContent);
  assert.ok(injection.content.includes("钉住 prepare 候选"));

  console.log("validate-thread-prepare-hint: passed", {
    candidates: freshState.prepareHint?.suggestedSearchLines.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * A085：延续会话时从 thread 滚动记忆恢复 prepareHint。
 *
 * 运行：npm run validate:thread-prepare-hint
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

const COMPOSER = "src/components/agent-composer.tsx";
const USER_REQUEST = "继续：把首页左边的闭环/Loop 选择去掉";

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
    resolveInsideWorkspace(process.cwd(), COMPOSER),
    "utf8",
  );

  const runState = createAgentLoopRunState(USER_REQUEST);
  recordToolCall(runState, "file.read", { path: COMPOSER, content });
  captureUiPrepareHintFromFileRead(
    runState,
    COMPOSER,
    content,
    { layout: "triple" },
  );
  assert.ok(runState.prepareHint);

  const memoryContent = buildStructuredCompactedMemory({
    round: 2,
    method: "deterministic",
    pinnedFacts: emptyPinnedFacts(),
    summaryBody: "Task1: traced composer, have prepare candidates",
    changedFiles: [COMPOSER],
    pinnedPrepareHint: runState.prepareHint,
  });

  const freshState = createAgentLoopRunState(USER_REQUEST);
  assert.equal(freshState.prepareHint, undefined);

  restorePrepareHintFromThreadMemory(freshState, memoryContent, USER_REQUEST);
  assert.equal(freshState.prepareHint?.path, COMPOSER);
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

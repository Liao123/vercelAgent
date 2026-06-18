/**
 * A084：长对话压缩后 prepareHint / Candidate 仍留在滚动记忆。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildRuntimeCheckpoint,
  createAgentLoopRunState,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import {
  buildUiPrepareNudgeBlock,
  captureUiPrepareHintFromFileRead,
} from "../src/agent/core/ui-prepare-nudge";
import {
  buildToolObservationMessage,
  compactAgentLoopMessages,
  parseCompactedMemory,
} from "../src/agent/memory/loop-context-compactor";
import {
  extractPrepareHintFromMessages,
  SECTION_PREPARE_HINT_ZH,
} from "../src/agent/memory/loop-prepare-hint-pin";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";
import type { AgentMessage } from "../src/agent/types";
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

function appendReadBurst(messages: AgentMessage[], count: number) {
  for (let i = 0; i < count; i += 1) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: `src/bulk-${i}.tsx` },
      }),
    });
    messages.push(
      buildToolObservationMessage("file.read", {
        path: `src/bulk-${i}.tsx`,
        content: `export const Bulk${i} = 1;\n`.repeat(500),
      }),
    );
  }
}

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const sidebarContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, SIDEBAR_PATH),
    "utf8",
  );

  const runState = createAgentLoopRunState(GOLDEN_UI_QUERY);
  runState.toolsCalled.push("file.locate");
  runState.disambiguation = {
    label: GOLDEN_DISAMBIGUATION_LABEL,
    mustReadPaths: [SIDEBAR_PATH, PANEL_PATH],
    recommendedPath: SIDEBAR_PATH,
    selectionRationale: "sidebar plus intent",
  };
  const panelContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, PANEL_PATH),
    "utf8",
  );
  recordToolCall(runState, "file.read", { path: SIDEBAR_PATH, content: sidebarContent });
  recordToolCall(runState, "file.read", { path: PANEL_PATH, content: panelContent });
  captureUiPrepareHintFromFileRead(
    runState,
    SIDEBAR_PATH,
    sidebarContent,
    GOLDEN_UI_CONTEXT,
  );
  assert.ok(runState.prepareHint, "runState should have prepareHint");

  const checkpoint = buildRuntimeCheckpoint(runState);
  const nudge = buildUiPrepareNudgeBlock(runState);
  assert.ok(nudge, "nudge block required");
  assert.ok(
    runState.prepareHint?.path === SIDEBAR_PATH,
    "runState.prepareHint should pin sidebar path for compaction input",
  );

  const messages: AgentMessage[] = [
    { role: "system", content: "You are a coding agent." },
    { role: "user", content: GOLDEN_UI_QUERY },
    {
      role: "user",
      content: `Reflection (runtime):\n理解: 已定位 sidebar\n下一步: prepare\n\n${checkpoint}`,
    },
  ];
  appendReadBurst(messages, 12);

  const round1 = await compactAgentLoopMessages({
    messages,
    userRequest: GOLDEN_UI_QUERY,
    provider: null,
    enableSemanticCompact: false,
    compactRound: 1,
    filesReadPaths: runState.filesRead,
    prepareHint: runState.prepareHint,
  });

  assert.notEqual(round1.method, "none", "round1 should compact");
  assert.ok(round1.memoryContent?.includes(SECTION_PREPARE_HINT_ZH));
  assert.ok(round1.memoryContent?.includes(SIDEBAR_PATH));
  assert.ok(
    round1.memoryContent?.includes("+") ||
      round1.memoryContent?.includes("新建 Agent"),
    "memory should retain exact search candidates",
  );

  const parsed1 = parseCompactedMemory(round1.memoryContent ?? "");
  assert.ok(parsed1?.pinnedPrepareHint?.path === SIDEBAR_PATH);
  assert.ok(
    (parsed1?.pinnedPrepareHint?.suggestedSearchLines.length ?? 0) >= 1,
  );

  messages.length = 0;
  messages.push(...round1.messages);
  appendReadBurst(messages, 10);

  const round2 = await compactAgentLoopMessages({
    messages,
    userRequest: GOLDEN_UI_QUERY,
    provider: null,
    enableSemanticCompact: false,
    compactRound: 2,
    filesReadPaths: runState.filesRead,
    prepareHint: runState.prepareHint,
  });

  assert.notEqual(round2.method, "none", "round2 should compact again");
  const parsed2 = parseCompactedMemory(round2.memoryContent ?? "");
  assert.ok(parsed2?.pinnedPrepareHint?.path === SIDEBAR_PATH);
  assert.ok(
    (parsed2?.pinnedPrepareHint?.suggestedSearchLines.length ?? 0) >= 1,
    "second compaction round should keep prepare hint",
  );

  const fromMessages = extractPrepareHintFromMessages(round2.messages);
  assert.ok(fromMessages?.path === SIDEBAR_PATH);

  console.log("validate-prepare-hint-compaction: passed", {
    round1Candidates: parsed1?.pinnedPrepareHint?.suggestedSearchLines.length,
    round2Candidates: parsed2?.pinnedPrepareHint?.suggestedSearchLines.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

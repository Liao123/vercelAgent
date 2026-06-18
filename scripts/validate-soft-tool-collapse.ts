/**
 * A118：soft tool-collapse（middle 内过旧 tool 观测折叠，不 merge memory）。
 *
 * 运行：npm run validate:soft-tool-collapse
 */
import assert from "node:assert/strict";
import {
  buildToolObservationMessage,
  compactAgentLoopMessages,
  estimateMessagesTokens,
  shouldApplyCompactionMessages,
} from "../src/agent/memory/loop-context-compactor";
import {
  isSoftToolCollapseEnabled,
  isToolObservationMessage,
  needsSoftToolCollapse,
  SOFT_TOOL_COLLAPSE_STUB,
  softCollapseMiddleToolObservations,
} from "../src/agent/memory/loop-compaction-layers";
import { getMaxContextTokens, DEFAULT_TOKEN_BUDGET } from "../src/agent/memory/token-budget";
import type { AgentMessage } from "../src/agent/types";

async function main(): Promise<void> {
  assert.equal(isSoftToolCollapseEnabled(), true);

  const maxContext = getMaxContextTokens(DEFAULT_TOKEN_BUDGET);
  assert.ok(needsSoftToolCollapse(maxContext * 0.71, maxContext));
  assert.ok(!needsSoftToolCollapse(maxContext * 0.5, maxContext));

  function buildToolPair(index: number, lineCount: number): AgentMessage[] {
    return [
      {
        role: "assistant",
        content: JSON.stringify({
          action: "tool_call",
          tool: "file.read",
          args: { path: `src/file-${index}.ts` },
        }),
      },
      buildToolObservationMessage("file.read", {
        path: `src/file-${index}.ts`,
        content: "line\n".repeat(lineCount),
      }),
    ];
  }

  const middle: AgentMessage[] = [];
  for (let i = 0; i < 10; i += 1) {
    middle.push(...buildToolPair(i, 40));
  }

  const soft = softCollapseMiddleToolObservations(middle);
  assert.ok(soft.collapsedCount >= 4);
  assert.match(String(soft.messages[1]?.content), /Older tool result collapsed/);
  assert.ok(isToolObservationMessage(soft.messages.at(-1)!));

  const messages: AgentMessage[] = [
    { role: "system", content: "agent" },
    { role: "user", content: "长任务读很多文件" },
    ...middle,
    ...buildToolPair(99, 1_400),
    ...buildToolPair(100, 1_400),
    ...buildToolPair(101, 1_400),
    ...buildToolPair(102, 1_400),
  ];

  const tokensBefore = estimateMessagesTokens(messages);
  const prevMiddleTrigger = process.env.AGENT_LOOP_MIDDLE_MSG_TRIGGER;
  const prevMiddleTokens = process.env.AGENT_LOOP_MIDDLE_TOKEN_TRIGGER;
  const prevSoftRatio = process.env.AGENT_LOOP_SOFT_COLLAPSE_RATIO;
  process.env.AGENT_LOOP_MIDDLE_MSG_TRIGGER = "999";
  process.env.AGENT_LOOP_MIDDLE_TOKEN_TRIGGER = "999999";
  process.env.AGENT_LOOP_SOFT_COLLAPSE_RATIO = "0.30";

  assert.ok(needsSoftToolCollapse(tokensBefore, maxContext));
  assert.ok(
    tokensBefore < maxContext * DEFAULT_TOKEN_BUDGET.compressionThresholdRatio,
  );

  const compacted = await compactAgentLoopMessages({
    messages,
    userRequest: "长任务读很多文件",
    enableSemanticCompact: false,
    compactRound: 1,
  });

  if (prevMiddleTrigger === undefined) delete process.env.AGENT_LOOP_MIDDLE_MSG_TRIGGER;
  else process.env.AGENT_LOOP_MIDDLE_MSG_TRIGGER = prevMiddleTrigger;
  if (prevMiddleTokens === undefined) delete process.env.AGENT_LOOP_MIDDLE_TOKEN_TRIGGER;
  else process.env.AGENT_LOOP_MIDDLE_TOKEN_TRIGGER = prevMiddleTokens;
  if (prevSoftRatio === undefined) delete process.env.AGENT_LOOP_SOFT_COLLAPSE_RATIO;
  else process.env.AGENT_LOOP_SOFT_COLLAPSE_RATIO = prevSoftRatio;

  assert.equal(compacted.method, "none");
  assert.ok(compacted.layersApplied?.some((layer) => layer.startsWith("soft:")));
  assert.ok(compacted.estimatedTokensAfter < tokensBefore);
  assert.ok(shouldApplyCompactionMessages(compacted));
  assert.ok(
    compacted.messages.some((message) =>
      String(message.content).includes(SOFT_TOOL_COLLAPSE_STUB),
    ),
  );

  console.log("validate-soft-tool-collapse: passed", {
    layers: compacted.layersApplied,
    before: compacted.estimatedTokensBefore,
    after: compacted.estimatedTokensAfter,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

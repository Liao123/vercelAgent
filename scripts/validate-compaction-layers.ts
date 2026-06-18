/**
 * A109：五层压缩 snip / micro / reactive / collapse。
 */
import assert from "node:assert/strict";
import {
  buildToolObservationMessage,
  compactAgentLoopMessages,
} from "../src/agent/memory/loop-context-compactor";
import {
  isContextOverflowError,
  microCompactMiddleObservations,
  needsEmergencyCollapse,
  snipLowValueMiddleMessages,
} from "../src/agent/memory/loop-compaction-layers";
import type { AgentMessage } from "../src/agent/types";

function buildReflectMiddle(): AgentMessage[] {
  const middle: AgentMessage[] = [];
  for (let i = 0; i < 8; i += 1) {
    middle.push({
      role: "assistant",
      content: JSON.stringify({
        action: "reflect",
        understanding: `round ${i}`,
        plannedNext: "continue",
      }),
    });
    middle.push({
      role: "user",
      content: `Reflection (runtime): checkpoint ${i}`,
    });
  }
  middle.push(
    buildToolObservationMessage("file.read", {
      path: "src/a.ts",
      content: "x".repeat(8_000),
    }),
  );
  return middle;
}

async function main(): Promise<void> {
  assert.ok(isContextOverflowError(new Error("context_length_exceeded")));
  assert.ok(!isContextOverflowError(new Error("network timeout")));

  const middle = buildReflectMiddle();
  const snip = snipLowValueMiddleMessages(middle);
  assert.ok(snip.removedCount >= 2);
  assert.ok(snip.messages.length < middle.length);

  const micro = microCompactMiddleObservations(snip.messages);
  assert.ok(micro.compactedCount >= 1);
  assert.match(
    micro.messages.at(-1)?.content as string,
    /TOMBSTONE/,
  );

  const nativeMiddle: AgentMessage[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "file.read", arguments: "{}" } }],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: `Observation from file.read:\n${JSON.stringify({
        path: "src/a.ts",
        content: "x".repeat(8_000),
      })}`,
    },
  ];
  const nativeMicro = microCompactMiddleObservations(nativeMiddle);
  assert.equal(nativeMicro.compactedCount, 1);
  assert.equal(nativeMicro.messages[1]?.role, "tool");
  assert.match(String(nativeMicro.messages[1]?.content), /TOMBSTONE/);

  const messages: AgentMessage[] = [
    { role: "system", content: "agent" },
    { role: "user", content: "改侧栏加号" },
    ...middle,
    ...middle.slice(0, 4),
    {
      role: "assistant",
      content: JSON.stringify({ action: "final", summary: "done" }),
    },
  ];

  const compacted = await compactAgentLoopMessages({
    messages,
    userRequest: "改侧栏加号",
    enableSemanticCompact: false,
    compactRound: 1,
    forceCompact: true,
  });

  assert.notEqual(compacted.method, "none");
  assert.ok(
    compacted.layersApplied?.some(
      (layer) => layer.startsWith("snip") || layer.startsWith("micro"),
    ),
  );
  assert.ok(compacted.memoryContent?.includes("COMPACTED_MEMORY"));

  assert.ok(
    !needsEmergencyCollapse(compacted.estimatedTokensAfter, 28_000),
    "normal compact should stay under collapse threshold",
  );
  assert.ok(needsEmergencyCollapse(30_000, 28_000));

  console.log("validate-compaction-layers: passed", {
    layers: compacted.layersApplied,
    before: compacted.estimatedTokensBefore,
    after: compacted.estimatedTokensAfter,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * A125：工具观测墓碑 stub + 用户消息锚点。
 *
 * 运行：npm run validate:tombstone-stub
 */
import assert from "node:assert/strict";
import {
  buildToolObservationMessage,
  compactAgentLoopMessages,
  estimateMessagesTokens,
} from "../src/agent/memory/loop-context-compactor";
import {
  microCompactMiddleObservations,
  softCollapseMiddleToolObservations,
} from "../src/agent/memory/loop-compaction-layers";
import {
  buildToolObservationTombstone,
  extractTombstoneKeywords,
  extractUserMessageAnchors,
  parseToolObservationMeta,
  TOMBSTONE_MARKER,
} from "../src/agent/memory/loop-tombstone-stub";
import type { AgentMessage } from "../src/agent/types";

async function main(): Promise<void> {
  const observation = buildToolObservationMessage("file.read", {
    path: "src/components/agent-panel.tsx",
    content: "line\n".repeat(200),
    externalized: true,
    storagePath: ".agent-state/tool-results/tr_test.json",
    originalBytes: 12000,
  });

  const meta = parseToolObservationMeta(observation);
  assert.equal(meta.toolName, "file.read");
  assert.equal(meta.filePath, "src/components/agent-panel.tsx");
  assert.equal(meta.storagePath, ".agent-state/tool-results/tr_test.json");
  assert.ok(meta.tokenEstimate > 100);

  const keywords = extractTombstoneKeywords(
    "fix @src/components/agent-panel.tsx and agent-composer.tsx",
  );
  assert.ok(keywords.some((k) => k.includes("agent-panel.tsx")));

  const tombstone = buildToolObservationTombstone(observation, "soft");
  assert.ok(tombstone.includes(TOMBSTONE_MARKER));
  assert.ok(tombstone.includes("tool=file.read"));
  assert.ok(tombstone.includes("keywords:"));
  assert.ok(tombstone.includes("file.read .agent-state/tool-results/tr_test.json"));
  assert.ok(estimateMessagesTokens([{ role: "user", content: tombstone }]) < 120);

  const bigObservation = buildToolObservationMessage("file.read", {
    path: "src/a.ts",
    content: "line\n".repeat(1_500),
  });
  const middle: AgentMessage[] = [
    {
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: "src/a.ts" },
      }),
    },
    bigObservation,
  ];
  const micro = microCompactMiddleObservations(middle);
  assert.equal(micro.compactedCount, 1);
  assert.ok(String(micro.messages[1]?.content).includes(TOMBSTONE_MARKER));

  const soft = softCollapseMiddleToolObservations(middle, {
    protectRecentCount: 0,
  });
  assert.ok(String(soft.messages[1]?.content).includes("recall:"));

  const anchors = extractUserMessageAnchors([
    { role: "user", content: "plain text" },
    {
      role: "user",
      content: "see @src/foo.tsx ```code```",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "screenshot" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    },
  ]);
  assert.equal(anchors.length, 2);
  assert.ok(
    anchors.some(
      (anchor) => anchor.includes("[image]") || anchor.includes("screenshot"),
    ),
  );

  const messages: AgentMessage[] = [
    { role: "system", content: "agent" },
    {
      role: "user",
      content: "改 @src/components/agent-panel.tsx 附图说明",
    },
    ...Array.from({ length: 14 }, (_, i) => ({
      role: "assistant" as const,
      content: JSON.stringify({
        action: "reflect",
        reflection: { understanding: `step ${i}` },
      }),
    })),
    ...Array.from({ length: 14 }, (_, i) => ({
      role: "user" as const,
      content: `Reflection (runtime): step ${i}`,
    })),
  ];

  const compacted = await compactAgentLoopMessages({
    messages,
    userRequest: "改 agent-panel",
    enableSemanticCompact: false,
    compactRound: 1,
    forceCompact: true,
  });

  assert.notEqual(compacted.method, "none");
  assert.ok(compacted.memoryContent?.includes("## 用户锚点"));
  assert.ok(compacted.memoryContent?.includes("agent-panel"));

  console.log("validate-tombstone-stub: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

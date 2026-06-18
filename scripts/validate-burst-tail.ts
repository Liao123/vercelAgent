/**
 * A126：爆发段感知 tail（语义链完整 + 短爆发段整段保留）。
 *
 * 运行：npm run validate:burst-tail
 */
import assert from "node:assert/strict";
import {
  alignTailStartToSemanticChains,
  isBurstBoundaryUserMessage,
  isBurstTailEnabled,
  resolveBurstAwareTailStart,
} from "../src/agent/memory/loop-burst-tail";
import { splitLoopMessagesForCompaction } from "../src/agent/memory/loop-context-compactor";
import type { AgentMessage } from "../src/agent/types";

function buildMessages(): AgentMessage[] {
  const middle: AgentMessage[] = [];
  for (let i = 0; i < 10; i += 1) {
    middle.push({
      role: "assistant",
      content: JSON.stringify({
        action: "reflect",
        reflection: { understanding: `old ${i}` },
      }),
    });
    middle.push({
      role: "user",
      content: `Reflection (runtime): old ${i}`,
    });
  }

  const recentBurst: AgentMessage[] = [
    { role: "user", content: "补充：只改按钮颜色 @src/components/foo.tsx" },
    {
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: "src/components/foo.tsx" },
      }),
    },
    {
      role: "user",
      content: "Observation from file.read:\n{\"path\":\"src/components/foo.tsx\",\"content\":\"btn\"}",
    },
    {
      role: "assistant",
      content: JSON.stringify({ action: "reflect", reflection: { understanding: "read" } }),
    },
    {
      role: "user",
      content: "Reflection (runtime): latest",
    },
  ];

  return [
    { role: "system", content: "agent" },
    { role: "user", content: "初始任务" },
    ...middle,
    ...recentBurst,
  ];
}

async function main(): Promise<void> {
  assert.equal(isBurstTailEnabled(), true);

  const messages = buildMessages();
  const split = splitLoopMessagesForCompaction(messages);

  assert.ok(split.tail.length >= 4);
  assert.ok(split.tail.length <= 12);
  assert.ok(
    split.tail.some((message) =>
      message.content === "补充：只改按钮颜色 @src/components/foo.tsx",
    ),
    "short recent burst should stay entirely in tail",
  );
  assert.ok(
    split.tail.some((message) =>
      String(message.content).includes("Observation from file.read"),
    ),
    "tool observation should not be cut from tail",
  );
  assert.ok(
    split.tail.some(
      (message) =>
        message.role === "assistant" &&
        String(message.content).includes("file.read"),
    ),
  );

  const chainMessages: AgentMessage[] = [
    { role: "system", content: "s" },
    { role: "user", content: "task" },
    ...Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `fill ${i}`,
    })),
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_chain",
          type: "function",
          function: { name: "file_read", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_chain",
      content: "Observation from file.read:\n{\"ok\":true}",
    },
  ];

  const tailStart = resolveBurstAwareTailStart(chainMessages, 2, {
    minKeep: 4,
    maxKeep: 12,
  });
  const aligned = alignTailStartToSemanticChains(chainMessages, tailStart, 2);
  const tail = chainMessages.slice(aligned);
  assert.ok(
    tail.some((m) => m.role === "assistant" && m.tool_calls?.length),
  );
  assert.ok(tail.some((m) => m.role === "tool"));

  assert.equal(isBurstBoundaryUserMessage({ role: "user", content: "追问" }), true);
  assert.equal(
    isBurstBoundaryUserMessage({
      role: "user",
      content: "Observation from file.read: {}",
    }),
    false,
  );

  console.log("validate-burst-tail: passed", {
    tailLength: split.tail.length,
    middleLength: split.middle.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

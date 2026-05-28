/**
 * 长任务上下文压缩 smoke（无需 LLM / dev server）。
 *
 * 运行：npm run validate:compaction
 */
import assert from "node:assert/strict";
import {
  buildStructuredCompactedMemory,
  buildToolObservationMessage,
  compactAgentLoopMessages,
  isPrimaryTaskUserMessage,
  isThreadMemoryInjectionMessage,
  parseCompactedMemory,
  resolveLoopPinnedHeadCount,
  shapeToolResultForObservation,
  splitLoopMessagesForCompaction,
} from "../src/agent/memory/loop-context-compactor";
import { buildThreadMemoryInjectionMessage } from "../src/agent/memory/thread-memory-store";
import type { AgentMessage } from "../src/agent/types";

const APPROVAL_A = "approval_test-aaaa-bbbb-cccc";
const APPROVAL_B = "approval_test-dddd-eeee-ffff";
const USER_TASK = "请修改 src/app/page.tsx 的标题并准备审批";

function buildLongLoopMessages(): AgentMessage[] {
  const priorMemory = buildStructuredCompactedMemory({
    round: 1,
    method: "deterministic",
    pinnedFacts: {
      approvalIds: ["approval_prior-old-id"],
      filePaths: ["src/legacy.ts"],
      branches: [],
      errors: [],
      blockers: [],
      toolHighlights: ["file.read"],
    },
    summaryBody: "Prior thread: read legacy.ts once.",
    changedFiles: ["src/legacy.ts"],
  });

  const messages: AgentMessage[] = [
    { role: "system", content: "You are a coding agent." },
    buildThreadMemoryInjectionMessage(priorMemory),
    { role: "user", content: USER_TASK },
  ];

  for (let i = 0; i < 10; i += 1) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: `src/module-${i}.ts` },
      }),
    });
    messages.push(
      buildToolObservationMessage("file.read", {
        path: `src/module-${i}.ts`,
        content: `export const n${i} = ${i};\n`.repeat(400),
      }),
    );
    if (i % 3 === 2) {
      const approvalId = i < 6 ? APPROVAL_A : APPROVAL_B;
      messages.push({
        role: "assistant",
        content: JSON.stringify({
          action: "tool_call",
          tool: "file.replace.prepare",
          args: { path: "src/app/page.tsx" },
        }),
      });
      messages.push(
        buildToolObservationMessage("file.replace.prepare", {
          prepared: true,
          approval: {
            id: approvalId,
            title: `Write file (round ${i})`,
            status: "pending",
          },
          path: "src/app/page.tsx",
        }),
      );
    }
    messages.push({
      role: "user",
      content: `Reflection (runtime): checkpoint after step ${i}`,
    });
  }

  return messages;
}

async function main() {
  const messages = buildLongLoopMessages();
  const tailStart = Math.max(0, messages.length - 12);
  const headCount = resolveLoopPinnedHeadCount(messages, tailStart);

  assert.equal(messages[0].role, "system");
  assert.ok(isThreadMemoryInjectionMessage(messages[1]));
  assert.ok(isPrimaryTaskUserMessage(messages[2]));
  assert.equal(messageText(messages[2]), USER_TASK);
  assert.equal(headCount, 3, "head must be system + thread memory + current user task");

  const split = splitLoopMessagesForCompaction(messages);
  assert.equal(split.head.length, 3);
  assert.ok(split.middle.length >= 8);
  assert.equal(split.tail.length, 12);

  const shaped = shapeToolResultForObservation("file.replace.prepare", {
    approval: { id: APPROVAL_A, title: "t", status: "pending" },
    path: "src/app/page.tsx",
    oldContent: "x".repeat(20_000),
  }) as Record<string, unknown>;
  assert.equal(shaped.approvalId, APPROVAL_A);
  assert.ok(!("oldContent" in shaped));

  const first = await compactAgentLoopMessages({
    messages,
    userRequest: USER_TASK,
    provider: null,
    enableSemanticCompact: false,
    compactRound: 1,
  });

  assert.notEqual(first.method, "none", "first compaction should trigger");
  assert.ok(
    first.memoryContent?.includes("approval_prior-old-id"),
    "thread memory approval rolls into compacted pinned facts",
  );
  assert.ok(!first.memoryContent?.includes(USER_TASK));

  const allText = first.messages.map((m) => messageText(m)).join("\n");
  assert.ok(allText.includes(APPROVAL_A), "approval A survives in head/memory/tail");
  assert.ok(allText.includes(APPROVAL_B), "approval B survives in head/memory/tail");

  const headAfter = first.messages.slice(0, 3);
  assert.equal(messageText(headAfter[2]), USER_TASK);

  const parsed = parseCompactedMemory(first.memoryContent ?? "");
  assert.ok(parsed);
  assert.ok(
    parsed.pinnedFacts.approvalIds.includes(APPROVAL_A),
    "evicted middle pins earlier approval id",
  );

  const second = await compactAgentLoopMessages({
    messages: [
      ...first.messages,
      {
        role: "assistant",
        content: JSON.stringify({
          action: "tool_call",
          tool: "git.mutation.prepare",
          args: { operation: { type: "branch", branchName: "codex/test" } },
        }),
      },
      buildToolObservationMessage("git.mutation.prepare", {
        approval: {
          id: "approval_test-git-branch-001",
          title: "Create branch",
          status: "pending",
        },
        command: "git branch codex/test",
      }),
    ],
    userRequest: USER_TASK,
    provider: null,
    enableSemanticCompact: false,
    compactRound: (first.round ?? 1) + 1,
  });

  if (second.method !== "none") {
    assert.ok(
      second.memoryContent?.includes("approval_test-git-branch-001"),
      "second round keeps new approval in pinned memory",
    );
    assert.ok((second.round ?? 0) >= (first.round ?? 0));
  }

  console.log("validate-loop-compaction: all assertions passed");
  console.log(
    JSON.stringify(
      {
        headCount,
        firstMethod: first.method,
        firstRound: first.round,
        tokensBefore: first.estimatedTokensBefore,
        tokensAfter: first.estimatedTokensAfter,
        pinnedApprovals: parsed?.pinnedFacts.approvalIds,
      },
      null,
      2,
    ),
  );
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

main().catch((error) => {
  console.error("validate-loop-compaction failed:", error);
  process.exit(1);
});

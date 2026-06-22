/**
 * Thread 跨 Task 记忆注入 smoke（无需 LLM / dev server）。
 *
 * 运行：npm run validate:thread-memory
 */
import assert from "node:assert/strict";
import {
  buildStructuredCompactedMemory,
  buildThreadMemoryAfterTask,
  compactAgentLoopMessages,
} from "../src/agent/memory/loop-context-compactor";
import {
  buildThreadMemoryInjectionMessage,
  deleteThreadMemory,
  getThreadMemory,
  saveThreadMemory,
} from "../src/agent/memory/thread-memory-store";
import type { AgentMessage } from "../src/agent/types";

const THREAD_ID = "thread_validate_continuation";
const WORKSPACE_ID = "ws_validate";
const APPROVAL_TASK1 = "approval_task1-aaaa-bbbb";
const TASK1_REQUEST = "在首页去掉鹊桥并准备审批";
const TASK2_REQUEST = "继续上次任务，告诉我待执行的 approval id";

async function main() {
  const task1Memory = buildStructuredCompactedMemory({
    round: 2,
    method: "deterministic",
    pinnedFacts: {
      approvalIds: [APPROVAL_TASK1],
      filePaths: ["src/app/page.tsx"],
      branches: [],
      errors: [],
      blockers: [],
      toolHighlights: ["file.replace.prepare"],
    },
    summaryBody: "Prepared write to src/app/page.tsx; user must approve in UI.",
    changedFiles: ["src/app/page.tsx"],
  });

  saveThreadMemory({
    threadId: THREAD_ID,
    workspaceId: WORKSPACE_ID,
    summaryId: "summary_validate_1",
    memoryContent: task1Memory,
    round: 2,
    method: "deterministic",
    updatedAt: new Date().toISOString(),
    lastTaskId: "task_validate_1",
    lastUserRequest: TASK1_REQUEST,
    title: TASK1_REQUEST.slice(0, 40),
    summaryPreview: task1Memory.slice(0, 200),
  });

  const stored = getThreadMemory(THREAD_ID);
  assert.ok(stored?.memoryContent.includes(APPROVAL_TASK1));

  const injection = buildThreadMemoryInjectionMessage(stored!.memoryContent);
  assert.ok(injection.content.includes(APPROVAL_TASK1));
  assert.ok(injection.content.includes("[THREAD_MEMORY]"));

  const task2Messages: AgentMessage[] = [
    { role: "system", content: "You are a coding agent." },
    injection,
    { role: "user", content: TASK2_REQUEST },
  ];

  for (let i = 0; i < 18; i += 1) {
    task2Messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: `src/chunk-${i}.ts` },
      }),
    });
    task2Messages.push({
      role: "user",
      content: `Observation from file.read:\n${JSON.stringify({
        path: `src/chunk-${i}.ts`,
        content: `export const chunk${i} = ${i};\n`.repeat(350),
      })}`,
    });
  }

  assert.equal(messageText(task2Messages[2]), TASK2_REQUEST);

  const compacted = await compactAgentLoopMessages({
    messages: task2Messages,
    userRequest: TASK2_REQUEST,
    provider: null,
    enableSemanticCompact: false,
    compactRound: 3,
  });

  assert.notEqual(compacted.method, "none");
  assert.ok(
    compacted.memoryContent?.includes(APPROVAL_TASK1),
    "task2 compaction keeps task1 approval in pinned memory",
  );
  assert.equal(messageText(compacted.messages[2]), TASK2_REQUEST);

  const shortTurnMemory = buildThreadMemoryAfterTask({
    messages: [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: TASK1_REQUEST },
      {
        role: "assistant",
        content: "已定位首页组件，等待用户确认是否去掉鹊桥。",
      },
    ],
    userRequest: TASK1_REQUEST,
    summary: "已定位首页组件，等待用户确认是否去掉鹊桥。",
    compactRound: 0,
  });
  assert.ok(
    shortTurnMemory.memoryContent.includes(TASK1_REQUEST),
    "short task saves user request without compaction",
  );
  assert.ok(
    shortTurnMemory.memoryContent.includes("等待用户确认"),
    "short task saves agent outcome without compaction",
  );

  const turn2Memory = buildThreadMemoryAfterTask({
    messages: [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: TASK2_REQUEST },
      { role: "assistant", content: "approval id 是 approval_task1-aaaa-bbbb。" },
    ],
    userRequest: TASK2_REQUEST,
    summary: "approval id 是 approval_task1-aaaa-bbbb。",
    priorMemoryContent: shortTurnMemory.memoryContent,
    compactRound: 0,
  });
  assert.ok(
    turn2Memory.memoryContent.includes(TASK1_REQUEST),
    "second turn keeps first user request in thread memory",
  );
  assert.ok(
    turn2Memory.memoryContent.includes(TASK2_REQUEST),
    "second turn records latest user request",
  );

  console.log("validate-thread-continuation: all assertions passed");
  console.log(
    JSON.stringify(
      {
        threadId: THREAD_ID,
        method: compacted.method,
        round: compacted.round,
        pinnedInMemory: APPROVAL_TASK1,
        tokensBefore: compacted.estimatedTokensBefore,
        tokensAfter: compacted.estimatedTokensAfter,
      },
      null,
      2,
    ),
  );

  deleteThreadMemory(THREAD_ID);
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

main().catch((error) => {
  console.error("validate-thread-continuation failed:", error);
  process.exit(1);
});

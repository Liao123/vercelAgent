/**
 * 长任务 + 延续会话 + 第二轮压缩 综合 smoke（无需 LLM / dev server）。
 *
 * 场景：
 * 1) Task1 长 Loop → 第 1、2 轮压缩 → 写入 thread-memory
 * 2) Task2 延续会话 → 注入 thread 记忆 → 再压第 3、4 轮
 *
 * 运行：npm run validate:long-thread-compaction
 */
import assert from "node:assert/strict";
import {
  buildToolObservationMessage,
  compactAgentLoopMessages,
  isPrimaryTaskUserMessage,
  isThreadMemoryInjectionMessage,
  parseCompactedMemory,
} from "../src/agent/memory/loop-context-compactor";
import {
  buildThreadMemoryInjectionMessage,
  deleteThreadMemory,
  getThreadMemory,
  saveThreadMemory,
} from "../src/agent/memory/thread-memory-store";
import type { AgentMessage } from "../src/agent/types";

const THREAD_ID = "thread_validate_long";
const WORKSPACE_ID = "ws_validate_long";
const TASK1_APPROVAL = "approval_task1-long-aaaa";
const TASK2_APPROVAL = "approval_task2-long-bbbb";
const TASK1_REQUEST = "修改首页标题并准备 file.replace 审批";
const TASK2_REQUEST = "延续上次：告诉我待执行的 approval id，并继续只读扫描 src/components";

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

function appendReadBurst(messages: AgentMessage[], prefix: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: `${prefix}-${i}.tsx` },
      }),
    });
    messages.push(
      buildToolObservationMessage("file.read", {
        path: `${prefix}-${i}.tsx`,
        content: `export const Block${i} = () => null;\n`.repeat(420),
      }),
    );
    if (i % 4 === 3) {
      messages.push({
        role: "user",
        content: `Reflection (runtime):\n理解: 已读 ${i + 1} 个文件\n下一步: 继续读取`,
      });
    }
  }
}

function appendPrepare(
  messages: AgentMessage[],
  approvalId: string,
  path: string,
) {
  messages.push({
    role: "assistant",
    content: JSON.stringify({
      action: "tool_call",
      tool: "file.replace.prepare",
      args: { path, search: "old", replace: "new" },
    }),
  });
  messages.push(
    buildToolObservationMessage("file.replace.prepare", {
      prepared: true,
      approval: {
        id: approvalId,
        title: `Write ${path}`,
        status: "pending",
      },
      path,
    }),
  );
}

function buildPostCompactBurst(prefix: string, count: number): AgentMessage[] {
  const burst: AgentMessage[] = [];
  appendReadBurst(burst, prefix, count);
  return burst;
}

async function compactRound(
  messages: AgentMessage[],
  userRequest: string,
  round: number,
) {
  const result = await compactAgentLoopMessages({
    messages,
    userRequest,
    provider: null,
    enableSemanticCompact: false,
    compactRound: round,
  });
  assert.notEqual(result.method, "none", `round ${round} should compact`);
  assert.ok(result.memoryContent, `round ${round} needs memoryContent`);
  assert.ok(
    result.estimatedTokensAfter <= result.estimatedTokensBefore,
    `round ${round} tokens ${result.estimatedTokensBefore} → ${result.estimatedTokensAfter}`,
  );
  return result;
}

async function main() {
  // ── Task 1 ──
  const task1Messages: AgentMessage[] = [
    { role: "system", content: "You are a coding agent." },
    { role: "user", content: TASK1_REQUEST },
  ];
  appendReadBurst(task1Messages, "src/pages/task1", 14);
  appendPrepare(task1Messages, TASK1_APPROVAL, "src/app/page.tsx");

  const task1Round1 = await compactRound(task1Messages, TASK1_REQUEST, 1);
  assert.ok(task1Round1.memoryContent!.includes(TASK1_APPROVAL));

  const task1Round2 = await compactRound(
    [...task1Round1.messages, ...buildPostCompactBurst("task1-after-r1", 8)],
    TASK1_REQUEST,
    2,
  );
  assert.equal(task1Round2.round, 2);
  assert.ok(task1Round2.memoryContent!.includes(TASK1_APPROVAL));
  assert.equal(messageText(task1Round1.messages[1]), TASK1_REQUEST);

  saveThreadMemory({
    threadId: THREAD_ID,
    workspaceId: WORKSPACE_ID,
    summaryId: "summary_long_1",
    memoryContent: task1Round2.memoryContent!,
    round: task1Round2.round,
    method: "deterministic",
    updatedAt: new Date().toISOString(),
    lastTaskId: "task_long_1",
    lastUserRequest: TASK1_REQUEST,
    title: TASK1_REQUEST.slice(0, 40),
    summaryPreview: task1Round2.summaryPreview,
  });

  const stored = getThreadMemory(THREAD_ID);
  assert.ok(stored?.memoryContent.includes(TASK1_APPROVAL));

  // ── Task 2（延续会话）──
  const injection = buildThreadMemoryInjectionMessage(stored!.memoryContent);
  const task2Messages: AgentMessage[] = [
    { role: "system", content: "You are a coding agent." },
    injection,
    { role: "user", content: TASK2_REQUEST },
  ];

  assert.ok(isThreadMemoryInjectionMessage(task2Messages[1]));
  assert.ok(isPrimaryTaskUserMessage(task2Messages[2]));
  assert.equal(messageText(task2Messages[2]), TASK2_REQUEST);

  appendReadBurst(task2Messages, "src/components/task2", 16);
  appendPrepare(task2Messages, TASK2_APPROVAL, "src/components/agent-panel.tsx");

  const task2Round3 = await compactRound(task2Messages, TASK2_REQUEST, 3);
  assert.equal(task2Round3.round, 3);
  assert.ok(
    task2Round3.memoryContent!.includes(TASK1_APPROVAL),
    "task2 round3 keeps task1 approval from thread head",
  );
  assert.ok(task2Round3.memoryContent!.includes(TASK2_APPROVAL));
  assert.equal(messageText(task2Round3.messages[2]), TASK2_REQUEST);

  const parsedR3 = parseCompactedMemory(task2Round3.memoryContent!);
  assert.ok(parsedR3?.pinnedFacts.approvalIds.includes(TASK1_APPROVAL));
  assert.ok(parsedR3?.pinnedFacts.approvalIds.includes(TASK2_APPROVAL));

  const task2Round4 = await compactRound(
    [...task2Round3.messages, ...buildPostCompactBurst("task2-after-r3", 10)],
    TASK2_REQUEST,
    4,
  );
  assert.equal(task2Round4.round, 4);
  assert.ok(task2Round4.memoryContent!.includes(TASK1_APPROVAL));
  assert.ok(task2Round4.memoryContent!.includes(TASK2_APPROVAL));
  assert.equal(messageText(task2Round4.messages[2]), TASK2_REQUEST);
  assert.ok(
    task2Round4.estimatedTokensAfter < task2Round4.estimatedTokensBefore,
    "round4 should compress relative to its own pre-compact size",
  );

  const parsedR4 = parseCompactedMemory(task2Round4.memoryContent!);
  assert.ok(parsedR4?.summaryBody.includes("Prior") || parsedR4?.summaryBody.length > 20);

  console.log("validate-long-thread-compaction: all assertions passed");
  console.log(
    JSON.stringify(
      {
        threadId: THREAD_ID,
        rounds: [1, 2, 3, 4],
        tokens: {
          task1r1: [
            task1Round1.estimatedTokensBefore,
            task1Round1.estimatedTokensAfter,
          ],
          task1r2: [
            task1Round2.estimatedTokensBefore,
            task1Round2.estimatedTokensAfter,
          ],
          task2r3: [
            task2Round3.estimatedTokensBefore,
            task2Round3.estimatedTokensAfter,
          ],
          task2r4: [
            task2Round4.estimatedTokensBefore,
            task2Round4.estimatedTokensAfter,
          ],
        },
        pinned: parsedR4?.pinnedFacts.approvalIds,
      },
      null,
      2,
    ),
  );

  deleteThreadMemory(THREAD_ID);
}

main().catch((error) => {
  console.error("validate-long-thread-compaction failed:", error);
  process.exit(1);
});

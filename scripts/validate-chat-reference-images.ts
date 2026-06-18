/**
 * A124：聊天区用户气泡展示附图（task.referenceImages → UserBubble）。
 *
 * 运行：npm run validate:chat-reference-images
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { groupEventsIntoTurns } from "../src/lib/agent-turn-feed";
import type { AgentEvent, Task } from "../src/agent/types";

const sampleImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function taskCreated(task: Partial<Task> & Pick<Task, "id" | "userRequest">): AgentEvent {
  const now = new Date().toISOString();
  return {
    type: "task.created",
    taskId: task.id,
    task: {
      id: task.id,
      threadId: "thread_test",
      workspaceId: "workspace_test",
      userRequest: task.userRequest,
      referenceImages: task.referenceImages,
      status: "running",
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function main(): Promise<void> {
  const turns = groupEventsIntoTurns([
    taskCreated({
      id: "task_img",
      userRequest: "请根据附图完成开发任务。",
      referenceImages: [sampleImage],
    }),
    {
      type: "task.completed",
      taskId: "task_img",
      summary: "done",
      task: {
        id: "task_img",
        threadId: "thread_test",
        workspaceId: "workspace_test",
        userRequest: "请根据附图完成开发任务。",
        referenceImages: [sampleImage],
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    },
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.referenceImages?.length, 1);
  assert.ok(turns[0]?.referenceImages?.[0]?.startsWith("data:image/"));

  const loop = await fs.readFile(
    `${process.cwd()}/src/agent/core/agent-loop.ts`,
    "utf8",
  );
  const turnBlock = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-block.tsx`,
    "utf8",
  );
  assert.ok(loop.includes("referenceImages:"));
  assert.ok(turnBlock.includes("images={turn.referenceImages}"));
  assert.ok(turnBlock.includes("max-h-48"));

  console.log("validate-chat-reference-images: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

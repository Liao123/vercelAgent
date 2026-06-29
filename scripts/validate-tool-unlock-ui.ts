import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  groupNarrativeIntoSteps,
  summarizeReasoningTimeline,
} from "../src/lib/agent-reasoning-steps";
import { extractToolUnlocks } from "../src/lib/agent-tool-unlocks";

async function main(): Promise<void> {
  const sampleResult = {
    matches: [
      {
        name: "devtools.get_computed_style",
        description: "Read computed styles.",
        args: { selector: "CSS selector" },
        score: 9,
      },
    ],
    unlockedTools: ["devtools.get_computed_style", "devtools.get_screenshot"],
  };

  const unlocks = extractToolUnlocks(sampleResult);
  assert.equal(unlocks.length, 2);
  assert.equal(unlocks[0]?.name, "devtools.get_computed_style");
  assert.equal(unlocks[0]?.args?.selector, "CSS selector");
  assert.equal(unlocks[1]?.name, "devtools.get_screenshot");

  const toolOnlySteps = groupNarrativeIntoSteps([
    {
      type: "tool.completed",
      taskId: "task_1",
      toolCall: {
        id: "tool_1",
        taskId: "task_1",
        toolName: "workspace.inspect",
        args: {},
        rationale: "preload workspace facts",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
      result: { ok: true },
    },
  ]);
  assert.equal(toolOnlySteps.length, 1);
  assert.equal(toolOnlySteps[0]?.synthetic, true);
  assert.equal(toolOnlySteps[0]?.reflection.understanding, "");
  assert.equal(toolOnlySteps[0]?.reflection.plannedNext, "");
  const toolOnlySummary = summarizeReasoningTimeline(toolOnlySteps, {
    isActive: false,
  });
  assert.equal(toolOnlySummary.stepCount, 0);
  assert.ok(toolOnlySummary.preview.includes("preload workspace facts"));

  const timeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-reasoning-timeline.tsx`,
    "utf8",
  );
  const eventTimeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-event-timeline.tsx`,
    "utf8",
  );

  assert.ok(timeline.includes("ToolUnlockList"));
  assert.ok(timeline.includes('toolCall.toolName === "tool.search"'));
  assert.ok(eventTimeline.includes("ToolUnlockPanel"));
  assert.ok(eventTimeline.includes("extractToolUnlocks(event.result)"));

  console.log("validate-tool-unlock-ui: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

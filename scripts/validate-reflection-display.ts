/**
 * Codex-like reflection display:
 * checklist lives in update_plan; reflection stays concise.
 *
 * Run: npm run validate:reflection-display
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { reasoningToReflection } from "../src/agent/core/loop-reasoning";
import type { TaskReasoning } from "../src/agent/core/loop-reasoning";
import {
  compactReflectionText,
  stripInternalPlanLines,
} from "../src/lib/agent-reflection-display";

const reasoning: TaskReasoning = {
  understanding: "用户要把当前页面的按钮交互改成 Codex 风格。",
  intent: "code_edit",
  risk: "write",
  grounding: "workspace",
  evidenceNeeded: ["按钮组件位置", "当前样式"],
  planSteps: [
    "定位按钮组件",
    "修改交互样式",
    "运行专项验证",
  ],
  ambiguity: null,
  canAnswerNow: false,
  plannedNext: "读取按钮组件并确认当前实现。",
  source: "model",
};

const reflection = reasoningToReflection(reasoning);
assert.equal(reflection.understanding.includes("计划:"), false);
assert.equal(reflection.understanding.includes("定位按钮组件"), false);

assert.equal(
  stripInternalPlanLines("理解：要改按钮\n计划: 定位 → 修改 → 验证"),
  "理解：要改按钮",
);
assert.equal(
  compactReflectionText("下一步：读取文件并确认按钮实现", 20),
  "读取文件并确认按钮实现",
);
assert.ok(
  compactReflectionText("x".repeat(200), 40).endsWith("…"),
  "long reflection text should be truncated",
);

async function main(): Promise<void> {
  const timeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-reasoning-timeline.tsx`,
    "utf8",
  );
  const steps = await fs.readFile(
    `${process.cwd()}/src/lib/agent-reasoning-steps.ts`,
    "utf8",
  );
  const prompt = await fs.readFile(
    `${process.cwd()}/src/agent/prompts/loop-system.md`,
    "utf8",
  );

  assert.ok(timeline.includes("compactReflectionText"));
  assert.ok(steps.includes("compactReflectionText"));
  assert.ok(prompt.includes("do not repeat the full checklist"));

  console.log("validate-reflection-display: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

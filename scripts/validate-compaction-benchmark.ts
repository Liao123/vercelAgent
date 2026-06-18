/**
 * A119：长线程压缩层离线基准（soft / auto / collapse 触发率对比）。
 *
 * 运行：npm run validate:compaction-benchmark
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildToolObservationMessage,
  compactAgentLoopMessages,
  estimateMessagesTokens,
} from "../src/agent/memory/loop-context-compactor";
import { needsEmergencyCollapse } from "../src/agent/memory/loop-compaction-layers";
import { getMaxContextTokens, DEFAULT_TOKEN_BUDGET } from "../src/agent/memory/token-budget";
import type { AgentMessage } from "../src/agent/types";

function buildHeavyMessages(readCount: number): AgentMessage[] {
  const messages: AgentMessage[] = [
    { role: "system", content: "You are a coding agent." },
    { role: "user", content: "长任务：连续读取多个组件文件，只读不改。" },
  ];
  for (let i = 0; i < readCount; i += 1) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path: `src/components/block-${i}.tsx` },
      }),
    });
    messages.push(
      buildToolObservationMessage("file.read", {
        path: `src/components/block-${i}.tsx`,
        content: `export const Block${i} = () => null;\n`.repeat(80),
      }),
    );
    if (i % 5 === 4) {
      messages.push({
        role: "user",
        content: `Reflection (runtime):\n理解: 已读 ${i + 1} 个文件\n下一步: 继续`,
      });
    }
  }
  return messages;
}

async function runScenario(label: string, env: Record<string, string | undefined>) {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const messages = buildHeavyMessages(28);
  const before = estimateMessagesTokens(messages);
  const round1 = await compactAgentLoopMessages({
    messages,
    userRequest: "长任务压缩基准",
    provider: null,
    enableSemanticCompact: false,
    compactRound: 1,
  });
  const round2 = await compactAgentLoopMessages({
    messages: [...round1.messages, ...buildHeavyMessages(6).slice(2)],
    userRequest: "长任务压缩基准",
    provider: null,
    enableSemanticCompact: false,
    compactRound: 2,
  });

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const maxContext = getMaxContextTokens(DEFAULT_TOKEN_BUDGET);
  const layers = [
    ...(round1.layersApplied ?? []),
    ...(round2.layersApplied ?? []),
  ];
  const emergency = [round1, round2].some((round) =>
    round.layersApplied?.includes("collapse"),
  );

  return {
    label,
    tokensBefore: before,
    round1: {
      method: round1.method,
      before: round1.estimatedTokensBefore,
      after: round1.estimatedTokensAfter,
      layers: round1.layersApplied,
      emergency: needsEmergencyCollapse(round1.estimatedTokensAfter, maxContext),
    },
    round2: {
      method: round2.method,
      before: round2.estimatedTokensBefore,
      after: round2.estimatedTokensAfter,
      layers: round2.layersApplied,
      emergency: needsEmergencyCollapse(round2.estimatedTokensAfter, maxContext),
    },
    layers,
    emergency,
  };
}

async function main(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vec-bench-ext-"));
  const ctx = { workspaceRoot: tmpRoot, toolName: "file.read", toolCallId: "bench_1" };

  const withDefaults = await runScenario("default", {});
  const softOff = await runScenario("soft-off", { AGENT_LOOP_SOFT_COLLAPSE: "0" });

  assert.notEqual(withDefaults.round1.method, "none");
  assert.ok(
    withDefaults.layers.some((layer) => layer.startsWith("soft:")),
    "default config should trigger soft collapse on heavy thread",
  );
  assert.equal(
    withDefaults.emergency,
    false,
    "long-thread benchmark should not hit emergency collapse",
  );

  assert.ok(
    !softOff.layers.some((layer) => layer.startsWith("soft:")),
    "soft-off should not apply soft layer",
  );
  assert.ok(
    withDefaults.round1.after <= softOff.round1.after,
    "soft collapse should lower round1 tokens before memory compact",
  );

  const huge = buildHeavyMessages(1);
  huge.push(
    buildToolObservationMessage(
      "file.read",
      {
        path: "src/huge.ts",
        content: "x\n".repeat(20_000),
      },
      ctx,
    ),
  );
  const externalized = await compactAgentLoopMessages({
    messages: [
      { role: "system", content: "agent" },
      { role: "user", content: "read huge" },
      ...huge,
    ],
    userRequest: "read huge",
    provider: null,
    enableSemanticCompact: false,
    compactRound: 1,
    forceCompact: true,
  });
  assert.ok(
    externalized.messages.some((message) =>
      String(message.content).includes("externalized"),
    ),
    "externalize should shrink huge file.read in context",
  );

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  const report = {
    recordedAt: new Date().toISOString(),
    default: withDefaults,
    softOff,
    externalizeRound: {
      layers: externalized.layersApplied,
      before: externalized.estimatedTokensBefore,
      after: externalized.estimatedTokensAfter,
    },
  };
  const outDir = path.join(process.cwd(), ".agent-state", "compare");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "compaction-benchmark.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("validate-compaction-benchmark: passed");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

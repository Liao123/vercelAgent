import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  isRetriableModelError,
  withModelCallRetry,
} from "../src/lib/model-call-resilience.ts";
import {
  suggestMcpToolFallback,
  suggestMcpToolNotFound,
} from "../src/agent/mcp/tool-fallback.ts";

async function main(): Promise<void> {
  assert.ok(
    isRetriableModelError(
      new Error(
        '{"error":{"message":"Concurrency limit exceeded","type":"rate_limit_error"}}',
      ),
    ),
    "rate_limit retriable",
  );

  let attempts = 0;
  await withModelCallRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("rate_limit_error concurrency limit exceeded");
      }
      return "ok";
    },
    { maxRetries: 2, delayMs: 1 },
  );
  assert.equal(attempts, 2, "retry executed");

  const fallback = suggestMcpToolFallback(
    "chrome-devtools",
    "take_screenshot",
  );
  assert.ok(fallback?.useInstead === "devtools.get_screenshot");

  const missing = suggestMcpToolNotFound("mcp.chrome-devtools.take_screenshot");
  assert.ok(missing.useInstead === "devtools.get_screenshot");
  assert.ok(missing.hint.includes("agent.diagnose"));

  const graceful = await fs.readFile(
    "src/agent/core/loop-graceful-recovery-config.ts",
    "utf8",
  );
  assert.ok(graceful.includes("isGracefulRecoveryEnabled"), "graceful recovery config");

  const deterministic = await fs.readFile(
    "src/agent/core/loop-deterministic-recovery.ts",
    "utf8",
  );
  assert.ok(
    deterministic.includes("attemptDeterministicModelFailureRecovery"),
    "deterministic recovery",
  );

  const loop = await fs.readFile("src/agent/core/agent-loop.ts", "utf8");
  assert.ok(loop.includes("attemptDeterministicModelFailureRecovery"), "loop wired");

  const tools = await fs.readFile("src/agent/core/agent-loop-tools.ts", "utf8");
  assert.ok(tools.includes("agent.bootstrap.check"), "bootstrap tool registered");

  const runner = await fs.readFile(
    "src/agent/core/agent-loop-tool-runner.ts",
    "utf8",
  );
  assert.ok(runner.includes("suggestMcpToolFallback"), "MCP fallback in runner");

  const prompt = await fs.readFile(
    "src/agent/prompts/loop-system-native.md",
    "utf8",
  );
  assert.ok(prompt.includes("agent.diagnose"), "prompt mentions diagnose");

  console.log("validate-agent-resilience: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

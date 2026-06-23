import assert from "node:assert/strict";
import {
  assertKernelWriteAllowed,
  buildKernelBootstrapFollowUp,
  buildKernelBootstrapPlan,
  buildKernelBootstrapSideEffect,
  evaluateKernelWritePath,
  isKernelAutoValidateEnabled,
  isKernelBootstrapEnabled,
  suggestValidateScriptsForPaths,
} from "../src/agent/core/kernel-bootstrap-policy.ts";

async function main(): Promise<void> {
  assert.ok(isKernelBootstrapEnabled(), "kernel bootstrap default on");

  const blocked = evaluateKernelWritePath(".env.local");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.tier, "blocked");

  const kernel = evaluateKernelWritePath("src/agent/core/agent-loop-tools.ts");
  assert.equal(kernel.allowed, true);
  assert.equal(kernel.tier, "kernel");

  assert.throws(
    () => assertKernelWriteAllowed(".env"),
    /禁止修改/,
  );

  const plan = buildKernelBootstrapPlan([
    "src/agent/mcp/registry.ts",
    "src/components/foo.tsx",
  ]);
  assert.ok(plan.ok);
  assert.ok(plan.validateScripts.some((s) => s.includes("mcp-integration")));
  assert.ok(plan.requiresDevRestart);

  const side = buildKernelBootstrapSideEffect(["src/agent/core/agent-loop.ts"]);
  assert.ok(side.validateCommand?.includes("validate:"));
  assert.ok(side.followUp?.includes("内核自举"));
  assert.ok(isKernelAutoValidateEnabled(), "auto validate default on");

  const followUp = buildKernelBootstrapFollowUp(["src/agent/core/agent-loop.ts"]);
  assert.ok(followUp?.includes("validate"));
  assert.ok(followUp?.includes("重启"));

  const scripts = suggestValidateScriptsForPaths([
    "src/agent-server/http-server.ts",
  ]);
  assert.ok(scripts.some((s) => s.includes("validate:agent-server")));

  const tools = await import("../src/agent/core/agent-loop-tools.ts");
  assert.ok(tools.getAgentLoopTool("agent.bootstrap.check"));

  const fs = await import("node:fs/promises");
  const validateFlow = await fs.readFile(
    "src/agent/core/kernel-bootstrap-validate.ts",
    "utf8",
  );
  assert.ok(validateFlow.includes("kernel.bootstrap.validate"));
  const reviewPanel = await fs.readFile(
    "src/components/agent-review-panel.tsx",
    "utf8",
  );
  assert.ok(reviewPanel.includes("KernelBootstrapBanner"));

  const restart = await import("../src/lib/kernel-bootstrap-restart.ts");
  assert.ok(
    restart.isKernelBootstrapValidateCommand("npm run validate:kernel-bootstrap"),
  );
  assert.equal(restart.suggestKernelDevRestartCommand(), "npm run dev:desktop");
  const restarted = restart.appendKernelBootstrapRestartAfterValidate(
    [
      {
        type: "kernel.bootstrap.validate",
        taskId: "t1",
        paths: ["src/agent/core/agent-loop.ts"],
        validateScripts: ["npm run validate:agent"],
        validateCommand: "npm run validate:agent",
        requiresDevRestart: true,
      },
    ] as import("../src/agent/types.ts").AgentEvent[],
    { taskId: "t1", command: "npm run validate:agent", success: true },
  );
  assert.ok(restarted.some((event) => event.type === "kernel.bootstrap.restart"));
  const restartEvent = restarted.find(
    (event) => event.type === "kernel.bootstrap.restart",
  ) as { restartCommand?: string } | undefined;
  assert.equal(restartEvent?.restartCommand, "npm run dev:desktop");
  assert.ok(reviewPanel.includes("复制重启命令"));

  const trial = await fs.readFile("scripts/kernel-bootstrap-trial.ts", "utf8");
  assert.ok(trial.includes("agent.bootstrap.check"));

  const prev = process.env.AGENT_KERNEL_BOOTSTRAP;
  process.env.AGENT_KERNEL_BOOTSTRAP = "0";
  const denied = evaluateKernelWritePath("src/agent/foo.ts");
  assert.equal(denied.allowed, false);
  if (prev === undefined) delete process.env.AGENT_KERNEL_BOOTSTRAP;
  else process.env.AGENT_KERNEL_BOOTSTRAP = prev;

  console.log("validate-kernel-bootstrap: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

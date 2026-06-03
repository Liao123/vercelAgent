import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const workspace = await read("src/components/agent-workspace.tsx");
  const devPanel = await read("src/components/agent-dev-develop-panel.tsx");

  assert.ok(
    workspace.includes("devMode &&"),
    "develop panel gated by dev mode",
  );
  assert.ok(
    !workspace.includes("<AgentDevDevelopPanel />") ||
      workspace.includes("{devMode && <AgentDevDevelopPanel"),
    "develop panel not always mounted",
  );
  assert.ok(
    workspace.includes("enableAgentDevModePersist"),
    "dev=1 persists developer flag",
  );
  assert.ok(devPanel.includes("aria-expanded={open}"), "develop panel collapsible");
  assert.ok(
    !devPanel.includes("Loop / 闭环"),
    "no Loop/闭环 toggle in dev panel",
  );

  console.log("validate-agent-dev-mode: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Codex-like tool display labels and targets.
 *
 * Run: npm run validate:tool-display
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  agentToolLabel,
  formatAgentToolAction,
  summarizeAgentToolTarget,
} from "../src/lib/agent-tool-display";

async function main(): Promise<void> {
  assert.equal(agentToolLabel("file.read"), "读取文件");
  assert.equal(agentToolLabel("file.mutation"), "写入文件");
  assert.equal(agentToolLabel("patch.apply"), "应用 Patch");
  assert.equal(agentToolLabel("shell.run.prepare"), "准备终端命令");

  assert.deepEqual(
    formatAgentToolAction({
      toolName: "file.mutation",
      args: { operation: { type: "create", path: "index.html" } },
    }),
    {
      action: "已写入文件",
      target: "index.html",
      label: "写入文件",
    },
  );

  assert.deepEqual(
    formatAgentToolAction({
      toolName: "shell.run.prepare",
      args: { command: "npm run validate:agent" },
      running: true,
    }),
    {
      action: "正在准备终端命令",
      target: "npm run validate:agent",
      label: "准备终端命令",
    },
  );

  assert.equal(
    summarizeAgentToolTarget(
      "browser.open",
      { url: "http://localhost:3000/" },
      null,
    ),
    "http://localhost:3000/",
  );
  assert.equal(
    summarizeAgentToolTarget(
      "tool.search",
      {},
      {
        matches: [
          {
            name: "browser.inspect",
            description: "Inspect browser",
          },
        ],
        unlockedTools: ["browser.inspect"],
      },
    ),
    "解锁 1 个工具",
  );

  const timeline = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-reasoning-timeline.tsx`,
    "utf8",
  );
  const worked = await fs.readFile(
    `${process.cwd()}/src/components/agent-turn-worked-line.tsx`,
    "utf8",
  );
  const events = await fs.readFile(
    `${process.cwd()}/src/components/agent-event-timeline.tsx`,
    "utf8",
  );

  for (const source of [timeline, worked, events]) {
    assert.ok(source.includes("formatAgentToolAction"));
  }
  assert.ok(!timeline.includes("const TOOL_LABELS"));
  assert.ok(!worked.includes("const TOOL_LABELS"));

  console.log("validate-tool-display: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

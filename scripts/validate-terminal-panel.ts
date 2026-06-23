/**
 * A167 终端面板 wiring（无需 dev server）。
 *
 * 运行：npm run validate:terminal-panel
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createTerminalLogEntry,
  formatTerminalLogBlock,
} from "../src/lib/terminal-session-log";

async function main(): Promise<void> {
  const rail = await fs.readFile("src/components/agent-right-rail.tsx", "utf8");
  const panel = await fs.readFile("src/components/agent-terminal-panel.tsx", "utf8");
  const agentPanel = await fs.readFile("src/components/agent-panel.tsx", "utf8");
  const pkg = await fs.readFile("package.json", "utf8");

  assert.ok(rail.includes('"terminal"'), "right rail has terminal tab");
  assert.ok(rail.includes("terminalPanel"), "right rail accepts terminal panel");
  assert.ok(panel.includes("@xterm/xterm"), "terminal uses xterm");
  assert.ok(panel.includes("interactiveEnabled"), "terminal supports interactive PTY");
  assert.ok(panel.includes("EventSource"), "terminal streams PTY via SSE");
  assert.ok(agentPanel.includes("terminalLogs"), "agent panel tracks terminal logs");
  assert.ok(agentPanel.includes("pushShellOutputToTerminal"), "shell output wired");
  assert.ok(pkg.includes("@xterm/xterm"), "xterm dependency");

  const entry = createTerminalLogEntry({
    id: "t1",
    command: "npm run validate:agent",
    success: true,
    output: "passed",
  });
  const block = formatTerminalLogBlock(entry);
  assert.ok(block.includes("npm run validate:agent"));
  assert.ok(block.includes("passed"));

  console.log("validate-terminal-panel: passed");
}

main().catch((error) => {
  console.error("validate-terminal-panel failed:", error);
  process.exit(1);
});

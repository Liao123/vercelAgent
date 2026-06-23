/**
 * A168 交互式 PTY wiring（无需 dev server UI）。
 *
 * 运行：npm run validate:pty-terminal
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearAllPtySessionsForTests,
  isAgentPtyEnabled,
  spawnPtySession,
  subscribePtySession,
  writePtySession,
  killPtySession,
} from "../src/agent/terminal/pty-session-manager";

async function main(): Promise<void> {
  const manager = await fs.readFile(
    "src/agent/terminal/pty-session-manager.ts",
    "utf8",
  );
  const route = await fs.readFile("src/app/api/agent/pty/route.ts", "utf8");
  const actions = await fs.readFile("src/agent/terminal/pty-actions.ts", "utf8");
  const stream = await fs.readFile(
    "src/app/api/agent/pty/[sessionId]/stream/route.ts",
    "utf8",
  );
  const panel = await fs.readFile("src/components/agent-terminal-panel.tsx", "utf8");
  const pkg = await fs.readFile("package.json", "utf8");
  const nextConfig = await fs.readFile("next.config.ts", "utf8");

  assert.ok(manager.includes("node-pty"), "pty manager uses node-pty");
  assert.ok(actions.includes('action === "spawn"'), "pty actions spawns sessions");
  assert.ok(route.includes('action === "spawn"') || route.includes("executePtyAction"), "pty API spawns sessions");
  assert.ok(route.includes("proxyPtyPost") || route.includes("executePtyAction"), "pty remote or local");
  assert.ok(stream.includes("text/event-stream"), "pty stream is SSE");
  assert.ok(panel.includes("interactiveEnabled"), "terminal panel supports PTY");
  assert.ok(panel.includes("EventSource"), "terminal panel streams PTY output");
  assert.ok(pkg.includes("node-pty"), "node-pty dependency");
  assert.ok(nextConfig.includes("node-pty"), "next externalizes node-pty");
  assert.ok(isAgentPtyEnabled(), "pty enabled by default");

  if (process.env.AGENT_PTY_ENABLED === "0") {
    console.log("validate-pty-terminal: skipped live spawn (AGENT_PTY_ENABLED=0)");
    console.log("validate-pty-terminal: passed");
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vec-pty-"));
  try {
    const session = spawnPtySession(tmp);
    assert.ok(session.id.startsWith("pty_"));
    assert.equal(session.workspaceRoot, tmp);

    const outputs: string[] = [];
    const unsub = subscribePtySession(session.id, (event) => {
      if (event.type === "output") outputs.push(event.data);
    });
    assert.ok(unsub);

    await new Promise((resolve) => setTimeout(resolve, 800));

    if (process.platform === "win32") {
      writePtySession(session.id, "Write-Output 'vec-pty-ok'\r\n");
    } else {
      writePtySession(session.id, "echo vec-pty-ok\n");
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const blob = outputs.join("");
    assert.ok(
      blob.includes("vec-pty-ok"),
      `expected echo output, got: ${blob.slice(0, 240)}`,
    );

    killPtySession(session.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    clearAllPtySessionsForTests();
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch {
      /* Windows: shell cwd may briefly lock temp dir */
    }
  }

  console.log("validate-pty-terminal: passed");
}

main().catch((error) => {
  console.error("validate-pty-terminal failed:", error);
  process.exit(1);
});

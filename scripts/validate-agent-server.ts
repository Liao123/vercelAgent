import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function testLoadEnv(): Promise<void> {
  const { loadProjectEnvFiles } = await import("../src/agent-server/load-env.ts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vec-agent-env-"));
  await fs.writeFile(
    path.join(dir, ".env"),
    "AGENT_TEST_FROM_ENV=alpha\nAGENT_TEST_OVERRIDE=from-env\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, ".env.local"),
    "AGENT_TEST_FROM_LOCAL=beta\nAGENT_TEST_OVERRIDE=from-local\n",
    "utf8",
  );

  const prev = {
    shell: process.env.AGENT_TEST_SHELL_ONLY,
    fromEnv: process.env.AGENT_TEST_FROM_ENV,
    fromLocal: process.env.AGENT_TEST_FROM_LOCAL,
    override: process.env.AGENT_TEST_OVERRIDE,
  };
  delete process.env.AGENT_TEST_FROM_ENV;
  delete process.env.AGENT_TEST_FROM_LOCAL;
  delete process.env.AGENT_TEST_OVERRIDE;
  process.env.AGENT_TEST_SHELL_ONLY = "shell";

  const loaded = loadProjectEnvFiles(dir);
  assert.deepEqual(loaded, [".env", ".env.local"]);
  assert.equal(process.env.AGENT_TEST_SHELL_ONLY, "shell");
  assert.equal(process.env.AGENT_TEST_FROM_ENV, "alpha");
  assert.equal(process.env.AGENT_TEST_FROM_LOCAL, "beta");
  assert.equal(process.env.AGENT_TEST_OVERRIDE, "from-local");

  if (prev.shell === undefined) delete process.env.AGENT_TEST_SHELL_ONLY;
  else process.env.AGENT_TEST_SHELL_ONLY = prev.shell;
  if (prev.fromEnv === undefined) delete process.env.AGENT_TEST_FROM_ENV;
  else process.env.AGENT_TEST_FROM_ENV = prev.fromEnv;
  if (prev.fromLocal === undefined) delete process.env.AGENT_TEST_FROM_LOCAL;
  else process.env.AGENT_TEST_FROM_LOCAL = prev.fromLocal;
  if (prev.override === undefined) delete process.env.AGENT_TEST_OVERRIDE;
  else process.env.AGENT_TEST_OVERRIDE = prev.override;

  await fs.rm(dir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  await testLoadEnv();

  const server = await fs.readFile("src/agent-server/http-server.ts", "utf8");
  assert.ok(server.includes("buildHarnessHealthPayload"), "health exposes harness version");
  assert.ok(
    await fs.readFile("src/agent-server/http-server.ts", "utf8").then((s) =>
      s.includes('from "@/agent/protocol/harness"'),
    ),
    "http-server imports harness health",
  );
  const runtime = await fs.readFile("src/agent/mcp/runtime.ts", "utf8");
  const remote = await fs.readFile("src/agent/mcp/remote-client.ts", "utf8");
  const script = await fs.readFile("scripts/agent-server.ts", "utf8");
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const env = await fs.readFile(".env.example", "utf8");
  const desktop = await fs.readFile("scripts/dev-desktop.mjs", "utf8");

  assert.ok(server.includes("/health"), "health route");
  assert.ok(server.includes("/mcp/call"), "mcp call route");
  assert.ok(server.includes('path === "/trace"'), "trace route");
  assert.ok(server.includes('path === "/pty"'), "pty route");
  const loopRoute = await fs.readFile("src/app/api/agent/loop/route.ts", "utf8");
  assert.ok(loopRoute.includes("proxyAgentLoopToServer"), "next loop proxy");
  assert.ok(loopRoute.includes("isRemoteLoopEnabled"), "remote loop switch");
  const tracesRoute = await fs.readFile("src/app/api/agent/traces/route.ts", "utf8");
  assert.ok(tracesRoute.includes("proxyTraceGet"), "next trace proxy");
  const ptyHandler = await fs.readFile("src/agent-server/pty-handler.ts", "utf8");
  assert.ok(ptyHandler.includes("handlePtyStreamGet"), "pty stream on agent-server");
  const remotePty = await fs.readFile("src/agent-server/remote-pty.ts", "utf8");
  assert.ok(remotePty.includes("isRemotePtyEnabled"), "remote pty switch");
  const ptyRoute = await fs.readFile("src/app/api/agent/pty/route.ts", "utf8");
  assert.ok(ptyRoute.includes("proxyPtyPost"), "next pty proxy");
  assert.ok(runtime.includes("useRemoteAgentServer"), "mcp runtime facade");
  assert.ok(remote.includes("remoteEnsureMcpReady"), "remote mcp client");
  assert.ok(pkg.scripts?.["agent-server"], "npm script agent-server");
  assert.ok(env.includes("AGENT_SERVER_URL"), "env documents AGENT_SERVER_URL");
  assert.ok(script.includes("startAgentHttpServer"), "agent-server entry");
  assert.ok(script.includes("loadAgentServerEnv"), "agent-server loads env files");
  assert.ok(desktop.includes("agent-server"), "dev:desktop starts agent-server");
  assert.ok(desktop.includes("AGENT_LOOP_REMOTE"), "dev:desktop defaults loop local");

  console.log("validate-agent-server: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

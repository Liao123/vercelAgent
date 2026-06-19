/**
 * A140：shell.run.prepare + 任意 workspace 命令策略静态验收。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyNpmScriptRisk,
  validateShellCommand,
} from "../src/agent/tools/shell-command-policy";
import {
  parseNpmRunCommand,
  sanitizeShellCommand,
} from "../src/agent/tools/shell-output";
import {
  getShellApprovalAction,
  prepareShellRun,
} from "../src/agent/tools/shell-tools";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const tools = await read("src/agent/core/agent-loop-tools.ts");
  const shellTools = await read("src/agent/tools/shell-tools.ts");
  const shellRoute = await read("src/app/api/agent/shell/route.ts");
  const executeRoute = await read("src/app/api/agent/approvals/execute/route.ts");
  const prompt = await read("src/agent/prompts/loop-system-native.md");
  const playbooks = await read("src/agent/core/task-playbooks.ts");

  assert.ok(tools.includes('"shell.run.prepare"'), "shell.run.prepare tool registered");
  assert.ok(
    tools.includes("prepareShellRun"),
    "agent-loop-tools imports prepareShellRun",
  );
  assert.ok(shellTools.includes("applyShellOperation"), "applyShellOperation export");
  assert.ok(shellTools.includes("prepareShellRun"), "prepareShellRun export");
  assert.ok(shellRoute.includes("parseOperation"), "shell API accepts raw command");
  assert.ok(executeRoute.includes("applyShellOperation"), "execute uses applyShellOperation");
  assert.ok(prompt.includes("shell.run.prepare"), "native prompt documents shell.run");
  assert.ok(playbooks.includes("capability-extension"), "capability-extension playbook");
  assert.ok(playbooks.includes("isCapabilityExtensionRequest"), "capability extension matcher");

  const allowed = validateShellCommand("npm run validate:agent");
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.risk, "low");

  const blocked = validateShellCommand("rm -rf /");
  assert.equal(blocked.allowed, false);

  const install = validateShellCommand("npm install lodash");
  assert.equal(install.allowed, true);
  assert.equal(install.risk, "high");

  assert.equal(classifyNpmScriptRisk("validate:agent"), "low");
  assert.equal(classifyNpmScriptRisk("dev"), "medium");

  assert.equal(sanitizeShellCommand("npm run build 'vite'"), "npm run build");
  assert.equal(parseNpmRunCommand("npm run build")?.script, "build");

  const { stripAnsiSequences, isLongRunningNpmScript, looksLikeDevServerReady } =
    await import("../src/agent/tools/shell-output");
  assert.equal(
    stripAnsiSequences("\u001b[32mVITE\u001b[0m ready"),
    "VITE ready",
  );
  assert.equal(isLongRunningNpmScript("dev"), true);
  assert.equal(isLongRunningNpmScript("build"), false);
  assert.equal(
    looksLikeDevServerReady("  ➜  Local:   http://localhost:5175/"),
    true,
  );

  const npmHash = getShellApprovalAction({
    type: "npm_script",
    script: "lint",
  });
  const rawHash = getShellApprovalAction({
    type: "raw",
    command: "npm run lint",
  });
  assert.notEqual(npmHash, rawHash, "operation hash distinguishes npm vs raw");

  const prepared = await prepareShellRun({
    rootPath: ROOT,
    taskId: "validate_shell_run",
    command: "npm run validate:shell-run",
    createApproval: false,
  });
  assert.equal(prepared.preview.available, true);
  assert.equal(prepared.preview.operationType, "raw");
  assert.equal(prepared.operation.type, "raw");

  const missingScript = await prepareShellRun({
    rootPath: ROOT,
    taskId: "validate_shell_run",
    command: "rm -rf /",
    createApproval: false,
  });
  assert.equal(missingScript.preview.available, false);

  console.log("validate-shell-run: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

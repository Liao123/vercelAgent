/**
 * A141-follow：shell 失败 recovery + dev-run playbook 离线验收。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  isDevRunRequest,
  resolveTaskPlaybook,
} from "../src/agent/core/task-playbooks";
import {
  buildApprovalLoopContinuationRequest,
  shouldResumeLoopAfterApprovalExecute,
} from "../src/lib/approval-loop-continuation";
import {
  looksLikeDevAlreadyRunning,
  looksLikeDevServerReady,
  looksLikeDevServerTerminalFailure,
  sanitizeShellCommand,
  suggestAlternateDevPort,
  stripAnsiSequences,
} from "../src/agent/tools/shell-output";

async function read(rel: string): Promise<string> {
  return fs.readFile(rel, "utf8");
}

async function main(): Promise<void> {
  const playbooks = await read("src/agent/core/task-playbooks.ts");
  const prompt = await read("src/agent/prompts/loop-system-native.md");
  const panel = await read("src/components/agent-panel.tsx");

  assert.ok(playbooks.includes('"dev-run"'), "dev-run playbook id");
  assert.ok(playbooks.includes("isDevRunRequest"), "isDevRunRequest export");
  assert.ok(playbooks.includes("localhost:3000"), "dev-run uses Next.js port");
  assert.ok(prompt.includes("dev-run"), "native prompt mentions dev-run playbook");
  assert.ok(prompt.includes("3000"), "native prompt mentions port 3000");
  assert.ok(panel.includes("maybeResumeLoopAfterApproval"), "panel resumes after shell");

  assert.ok(isDevRunRequest("跑一下 dev 能跑吗"), "dev run detect 1");
  assert.ok(isDevRunRequest("npm run dev 看看能不能启动"), "dev run detect 2");
  assert.ok(!isDevRunRequest("只读分析 package.json"), "not dev run read-only");

  const pb = resolveTaskPlaybook("跑一下 dev能跑吗");
  assert.equal(pb.id, "dev-run", "resolves dev-run playbook");

  assert.equal(
    suggestAlternateDevPort("npm run dev"),
    "npm run dev -- --port 3001",
  );
  assert.equal(suggestAlternateDevPort("npm run dev -- --port 3000"), null);
  assert.equal(
    sanitizeShellCommand("npm run dev -- -H 127.0.0.1 -p 3001"),
    "npm run dev -- --hostname 127.0.0.1 --port 3001",
  );

  const nextReady =
    "▲ Next.js 16.2.6\n- Local: http://127.0.0.1:3001\n✓ Ready in 525ms";
  assert.ok(looksLikeDevServerReady(nextReady), "next ready detect");
  const duplicate =
    `${nextReady}\n⨯ Another next dev server is already running.\n- Local: http://localhost:3000`;
  assert.ok(looksLikeDevAlreadyRunning(duplicate), "duplicate dev detect");
  assert.ok(
    !looksLikeDevServerReady(duplicate),
    "duplicate dev must not count as ready",
  );
  assert.ok(
    looksLikeDevServerTerminalFailure(duplicate),
    "duplicate dev is terminal failure",
  );

  const continuation = buildApprovalLoopContinuationRequest(
    {
      id: "ap_dev",
      title: "npm run dev",
      details: { kind: "shell_command" },
      execution: {
        status: "failed",
        error: "Port 3000 is in use",
        result: {
          kind: "shell_command",
          command: "npm run dev",
          success: false,
          output: "Port 3000 is in use, trying another one...",
        },
      },
    },
    {
      result: {
        applied: true,
        result: {
          command: "npm run dev",
          success: false,
          output: "Port 3000 is in use",
        },
      },
    },
    "跑一下 dev",
  );
  assert.ok(continuation.includes("--port 3001"), "continuation suggests alt port");
  assert.ok(continuation.includes("不得直接 final"), "continuation blocks failure-only final");

  const alreadyRunningContinuation = buildApprovalLoopContinuationRequest(
    {
      id: "ap_dup",
      title: "npm run dev -- --port 3001",
      details: { kind: "shell_command" },
      execution: {
        status: "failed",
        result: {
          kind: "shell_command",
          command: "npm run dev -- --port 3001",
          success: false,
          output: duplicate,
        },
      },
    },
    {
      result: {
        applied: true,
        result: {
          command: "npm run dev -- --port 3001",
          success: false,
          output: duplicate,
        },
      },
    },
    "跑一下 dev",
  );
  assert.ok(
    alreadyRunningContinuation.includes("不要再次 prepare dev"),
    "duplicate dev stops retry loop",
  );

  assert.ok(
    shouldResumeLoopAfterApprovalExecute({
      id: "x",
      title: "dev",
      details: { kind: "shell_command" },
    }),
  );

  assert.equal(
    stripAnsiSequences("\u001b[31mPort 3000\u001b[0m in use"),
    "Port 3000 in use",
  );

  console.log("validate-shell-recovery: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

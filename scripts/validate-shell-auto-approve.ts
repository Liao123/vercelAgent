/**
 * A161：低风控 shell 自动批准策略。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateShellCommand } from "../src/agent/tools/shell-command-policy";
import {
  canAutoApproveShellCommand,
  readAutoApproveShellCommands,
} from "../src/lib/agent-shell-auto-approve";

const lowShell = {
  status: "pending" as const,
  risk: "low" as const,
  title: "npm run validate:agent",
  details: {
    kind: "shell_command" as const,
    operationHash: "h",
    operation: { type: "raw" as const, command: "npm run validate:agent" },
    preview: {
      command: "npm run validate:agent",
      risk: "low" as const,
      notes: [],
      available: true,
      operationType: "raw" as const,
    },
  },
};

const devShell = {
  ...lowShell,
  risk: "medium" as const,
  title: "npm run dev",
  details: {
    ...lowShell.details,
    preview: {
      ...lowShell.details.preview,
      command: "npm run dev",
      risk: "medium" as const,
    },
  },
};

const gitPushShell = {
  ...lowShell,
  risk: "high" as const,
  title: "git push",
  details: {
    ...lowShell.details,
    preview: {
      ...lowShell.details.preview,
      command: "git push origin main",
      risk: "high" as const,
    },
  },
};

assert.equal(canAutoApproveShellCommand(lowShell, false), false);
assert.equal(canAutoApproveShellCommand(lowShell, true), true);
assert.equal(canAutoApproveShellCommand(devShell, true), false);
assert.equal(canAutoApproveShellCommand(gitPushShell, true), false);

const policyLow = validateShellCommand("npm run validate:loop-reasoning");
assert.equal(policyLow.risk, "low", "policy marks validate scripts low");
const policyDev = validateShellCommand("npm run dev");
assert.ok(policyDev.risk !== "low", "dev is not low risk");

assert.equal(typeof readAutoApproveShellCommands, "function");

const settings = fs.readFileSync(
  path.join(process.cwd(), "src/components/agent-agent-settings.tsx"),
  "utf8",
);
assert.ok(settings.includes("readAutoApproveShellCommands"), "composer settings toggle");

const panel = fs.readFileSync(
  path.join(process.cwd(), "src/components/agent-panel.tsx"),
  "utf8",
);
assert.ok(panel.includes("canAutoApproveShellCommand"), "panel auto-runs low-risk shell");

console.log("validate-shell-auto-approve: passed");

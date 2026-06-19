/**
 * 受控 Shell 工具：package.json scripts + 任意 workspace 命令（审批后执行）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createApprovalRequest, requireApprovedApproval } from "@/agent/approval";
import type { ApprovalRisk, ShellOperation, VerificationResult } from "@/agent/types";
import {
  classifyNpmScriptRisk,
  validateShellCommand,
} from "@/agent/tools/shell-command-policy";
import { sanitizeShellCommand } from "@/agent/tools/shell-output";
import { executeShellCommand } from "@/agent/tools/shell-runner";

export type { ShellOperation } from "@/agent/types";

export type PreparedShellCommand = {
  operation: ShellOperation;
  operationHash: string;
  requiredApprovalAction: string;
  approval?: ReturnType<typeof createApprovalRequest>;
  preview: {
    command: string;
    risk: ApprovalRisk;
    notes: string[];
    available: boolean;
    operationType: ShellOperation["type"];
    script?: string;
  };
};

export type AppliedShellCommand = PreparedShellCommand & {
  applied: boolean;
  result: VerificationResult;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function getShellApprovalAction(operation: ShellOperation): string {
  const hash = createHash("sha256")
    .update(stableStringify(operation))
    .digest("hex");
  return `shell.run:${hash}`;
}

async function readPackageScripts(rootPath: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(path.join(rootPath, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

function buildPreparedShellCommand(input: {
  operation: ShellOperation;
  taskId: string;
  createApproval?: boolean;
  preview: PreparedShellCommand["preview"];
}): PreparedShellCommand {
  const requiredApprovalAction = getShellApprovalAction(input.operation);
  const operationHash = requiredApprovalAction.replace("shell.run:", "");
  return {
    operation: input.operation,
    operationHash,
    requiredApprovalAction,
    approval:
      input.createApproval && input.preview.available
        ? createApprovalRequest({
            taskId: input.taskId,
            title: `Run ${input.preview.command}`,
            reason: `Execute command in workspace: ${input.preview.command}`,
            risk: input.preview.risk,
            action: requiredApprovalAction,
            details: {
              kind: "shell_command",
              operationHash,
              operation: input.operation,
              preview: input.preview,
            },
          })
        : undefined,
    preview: input.preview,
  };
}

export async function prepareShellCommand(input: {
  rootPath: string;
  taskId: string;
  script: string;
  createApproval?: boolean;
}): Promise<PreparedShellCommand> {
  const script = input.script.trim();
  const scripts = await readPackageScripts(input.rootPath);
  const available = script in scripts;
  const command = `npm run ${script}`;
  const notes = available
    ? [
        "Runs an npm script declared in package.json.",
        "Shell command runs in the workspace root directory.",
      ]
    : [`Missing npm script in package.json: ${script}`];

  const operation: ShellOperation = { type: "npm_script", script };
  return buildPreparedShellCommand({
    operation,
    taskId: input.taskId,
    createApproval: input.createApproval,
    preview: {
      command,
      risk: classifyNpmScriptRisk(script),
      notes,
      available,
      operationType: "npm_script",
      script,
    },
  });
}

export async function prepareShellRun(input: {
  rootPath: string;
  taskId: string;
  command: string;
  createApproval?: boolean;
}): Promise<PreparedShellCommand> {
  const sanitized = sanitizeShellCommand(input.command);
  const validation = validateShellCommand(sanitized);
  const operation: ShellOperation = {
    type: "raw",
    command: validation.command,
  };
  const notes = validation.allowed
    ? [...validation.notes]
    : [...validation.notes, validation.reason ?? "Command blocked."];

  return buildPreparedShellCommand({
    operation,
    taskId: input.taskId,
    createApproval: input.createApproval,
    preview: {
      command: validation.command,
      risk: validation.risk,
      notes,
      available: validation.allowed,
      operationType: "raw",
    },
  });
}

export async function applyShellOperation(input: {
  rootPath: string;
  taskId: string;
  operation: ShellOperation;
  approvalId: string;
}): Promise<AppliedShellCommand> {
  const prepared =
    input.operation.type === "npm_script"
      ? await prepareShellCommand({
          rootPath: input.rootPath,
          taskId: input.taskId,
          script: input.operation.script,
        })
      : await prepareShellRun({
          rootPath: input.rootPath,
          taskId: input.taskId,
          command: input.operation.command,
        });

  if (!prepared.preview.available) {
    throw new Error(
      prepared.preview.notes.find((note) => note.startsWith("Missing npm")) ??
        prepared.preview.notes.at(-1) ??
        "Shell command is not available.",
    );
  }

  const approval = requireApprovedApproval(input.approvalId);
  if (approval.action !== prepared.requiredApprovalAction) {
    throw new Error("Approval does not match this shell command.");
  }

  const command =
    input.operation.type === "npm_script"
      ? `npm run ${input.operation.script}`
      : input.operation.command;

  const result = await executeShellCommand(input.rootPath, command);
  return {
    ...prepared,
    applied: true,
    result,
  };
}

/** @deprecated Use applyShellOperation */
export async function applyShellCommand(input: {
  rootPath: string;
  taskId: string;
  script: string;
  approvalId: string;
}): Promise<AppliedShellCommand> {
  return applyShellOperation({
    rootPath: input.rootPath,
    taskId: input.taskId,
    operation: { type: "npm_script", script: input.script },
    approvalId: input.approvalId,
  });
}

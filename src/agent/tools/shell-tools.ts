/**
 * 受控 Shell 工具（仅白名单 npm scripts，与 verification 一致）。
 */
import { createHash } from "node:crypto";
import { createApprovalRequest, requireApprovedApproval } from "@/agent/approval";
import type { ApprovalShellScript } from "@/agent/types";
import {
  getVerificationPlan,
  runVerificationCommand,
} from "@/agent/verification";
import type { VerificationResult } from "@/agent/types";

export type ShellOperation = {
  type: "npm_script";
  script: ApprovalShellScript;
};

export type PreparedShellCommand = {
  operation: ShellOperation;
  operationHash: string;
  requiredApprovalAction: string;
  approval?: ReturnType<typeof createApprovalRequest>;
  preview: {
    command: string;
    risk: "medium";
    notes: string[];
    script: ApprovalShellScript;
    available: boolean;
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

const BLOCKED_NOTES = [
  "Only npm scripts declared in package.json are allowed.",
  "Arbitrary shell commands are not supported in the web agent.",
];

export async function prepareShellCommand(input: {
  rootPath: string;
  taskId: string;
  script: ApprovalShellScript;
  createApproval?: boolean;
}): Promise<PreparedShellCommand> {
  const operation: ShellOperation = { type: "npm_script", script: input.script };
  const requiredApprovalAction = getShellApprovalAction(operation);
  const operationHash = requiredApprovalAction.replace("shell.run:", "");
  const plan = await getVerificationPlan(input.rootPath, [input.script]);
  const available = plan.available.includes(input.script);
  const command = `npm run ${input.script}`;
  const notes = available
    ? [
        "Shell command runs in the current workspace directory.",
        "Output may be large; results are truncated in the UI.",
      ]
    : [...BLOCKED_NOTES, `Missing npm script: ${input.script}`];

  const preview = {
    command,
    risk: "medium" as const,
    notes,
    script: input.script,
    available,
  };

  return {
    operation,
    operationHash,
    requiredApprovalAction,
    approval:
      input.createApproval && available
        ? createApprovalRequest({
            taskId: input.taskId,
            title: `Run ${command}`,
            reason: `Execute ${command} in workspace.`,
            risk: "medium",
            action: requiredApprovalAction,
            details: {
              kind: "shell_command",
              operationHash,
              operation,
              preview,
            },
          })
        : undefined,
    preview,
  };
}

export async function applyShellCommand(input: {
  rootPath: string;
  taskId: string;
  script: ApprovalShellScript;
  approvalId: string;
}): Promise<AppliedShellCommand> {
  const prepared = await prepareShellCommand({
    rootPath: input.rootPath,
    taskId: input.taskId,
    script: input.script,
  });
  if (!prepared.preview.available) {
    throw new Error(`npm script is not available: ${input.script}`);
  }
  const approval = requireApprovedApproval(input.approvalId);
  if (approval.action !== prepared.requiredApprovalAction) {
    throw new Error("Approval does not match this shell command.");
  }
  const result = await runVerificationCommand(input.rootPath, input.script);
  if (!result.success) {
    throw new Error(result.output || `Command failed: ${prepared.preview.command}`);
  }
  return {
    ...prepared,
    applied: true,
    result,
  };
}

/**
 * 受控 Git 工具。
 *
 * git root、status、diff 是只读操作；branch/commit/push 必须先生成 approval，
 * apply 时再校验与本次 Git 操作 hash 匹配的已批准 approval。
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { contentSnapshot } from "@/agent/approval/content-snapshot";
import { createApprovalRequest, requireApprovedApproval } from "@/agent/approval";
import type {
  ApprovalGitMutationPreview,
  ApprovalGitWorkspaceSnapshot,
} from "@/agent/types";
import {
  parseGitStatusOutput,
  type GitStatusSnapshot,
} from "@/lib/git-status";

const execFileAsync = promisify(execFile);

export type GitCommandResult = {
  command: string;
  stdout: string;
  stderr: string;
};

export type GitStatusResult = GitCommandResult & GitStatusSnapshot;

export type GitMutationOperation =
  | {
      type: "branch";
      branchName: string;
      checkout?: boolean;
    }
  | {
      type: "commit";
      message: string;
      all?: boolean;
      paths?: string[];
    }
  | {
      type: "push";
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
    };

export type PreparedGitMutation = {
  operation: GitMutationOperation;
  operationHash: string;
  requiredApprovalAction: string;
  approval?: ReturnType<typeof createApprovalRequest>;
  preview: ApprovalGitMutationPreview;
};

export type AppliedGitMutation = PreparedGitMutation & {
  applied: boolean;
  result: GitCommandResult;
};

async function runGit(
  cwd: string,
  args: string[],
): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 5,
    });
    return {
      command: `git ${args.join(" ")}`,
      stdout,
      stderr,
    };
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      const execError = error as { stdout?: string; stderr?: string; message: string };
      return {
        command: `git ${args.join(" ")}`,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message,
      };
    }
    throw error;
  }
}

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

function validateBranchName(branchName: string): string {
  const trimmed = branchName.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("..")) {
    throw new Error("Invalid branch name.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    throw new Error("Branch name contains unsupported characters.");
  }
  return trimmed;
}

function validateCommitMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Commit message is required.");
  return trimmed;
}

function validateRemote(remote: string): string {
  const trimmed = remote.trim() || "origin";
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error("Remote contains unsupported characters.");
  }
  return trimmed;
}

function validateGitPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("-") || normalized.includes("\0")) {
    throw new Error("Invalid git path.");
  }
  return normalized;
}

function normalizeGitMutation(
  operation: GitMutationOperation,
): GitMutationOperation {
  if (operation.type === "branch") {
    return {
      type: "branch",
      branchName: validateBranchName(operation.branchName),
      checkout: operation.checkout !== false,
    };
  }
  if (operation.type === "commit") {
    return {
      type: "commit",
      message: validateCommitMessage(operation.message),
      all: operation.all === true,
      paths: operation.paths?.map(validateGitPath),
    };
  }
  return {
    type: "push",
    remote: validateRemote(operation.remote ?? "origin"),
    branch: operation.branch ? validateBranchName(operation.branch) : undefined,
    setUpstream: operation.setUpstream === true,
  };
}

export function getGitMutationApprovalAction(
  operation: GitMutationOperation,
): string {
  const normalized = normalizeGitMutation(operation);
  const operationHash = createHash("sha256")
    .update(stableStringify(normalized))
    .digest("hex");
  return `git.mutate:${operationHash}`;
}

function gitMutationArgs(operation: GitMutationOperation): string[] {
  const normalized = normalizeGitMutation(operation);
  if (normalized.type === "branch") {
    return normalized.checkout
      ? ["checkout", "-b", normalized.branchName]
      : ["branch", normalized.branchName];
  }
  if (normalized.type === "commit") {
    if (normalized.all) return ["commit", "-am", normalized.message];
    return normalized.paths?.length
      ? ["commit", "-m", normalized.message, "--", ...normalized.paths]
      : ["commit", "-m", normalized.message];
  }

  const args = ["push"];
  if (normalized.setUpstream) args.push("-u");
  args.push(normalized.remote ?? "origin");
  if (normalized.branch) args.push(normalized.branch);
  return args;
}

function commandText(args: string[]): string {
  return `git ${args
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(" ")}`;
}

async function collectGitWorkspaceSnapshot(
  cwd: string,
  operation: GitMutationOperation,
): Promise<ApprovalGitWorkspaceSnapshot | undefined> {
  try {
    const status = await getGitStatus(cwd);
    const diff = await getGitDiff(cwd);
    const branchResult = await runGit(cwd, ["branch", "--show-current"]);
    const branch = branchResult.stdout.trim() || status.branch || undefined;
    let remoteUrl: string | undefined;
    if (operation.type === "push") {
      const remote = operation.remote ?? "origin";
      const remoteResult = await runGit(cwd, ["remote", "get-url", remote]);
      remoteUrl = remoteResult.stdout.trim() || undefined;
    }
    return {
      branch,
      status: contentSnapshot(
        [status.stdout, status.stderr].filter(Boolean).join("\n"),
      ),
      statusSnapshot: {
        dirty: status.dirty,
        branch: status.branch,
        upstream: status.upstream,
        ahead: status.ahead,
        behind: status.behind,
        detached: status.detached,
        files: status.files,
        summary: status.summary,
      },
      diff: contentSnapshot(
        [diff.stdout, diff.stderr].filter(Boolean).join("\n"),
      ),
      remoteUrl,
    };
  } catch {
    return undefined;
  }
}

export async function prepareGitMutation(input: {
  cwd: string;
  taskId: string;
  operation: GitMutationOperation;
  createApproval?: boolean;
}): Promise<PreparedGitMutation> {
  const operation = normalizeGitMutation(input.operation);
  const requiredApprovalAction = getGitMutationApprovalAction(operation);
  const operationHash = requiredApprovalAction.replace("git.mutate:", "");
  const args = gitMutationArgs(operation);
  const risk = operation.type === "push" ? "high" : "medium";
  const notes = [
    "Git write operations require explicit approval before execution.",
  ];
  if (operation.type === "commit") {
    notes.push("Commit will capture the current git index or selected paths.");
  }
  if (operation.type === "push") {
    notes.push("Push sends local commits to a remote repository.");
  }
  const workspace = await collectGitWorkspaceSnapshot(input.cwd, operation);
  const preview: ApprovalGitMutationPreview = {
    command: commandText(args),
    risk,
    notes,
    workspace,
  };

  return {
    operation,
    operationHash,
    requiredApprovalAction,
    approval: input.createApproval
      ? createApprovalRequest({
          taskId: input.taskId,
          title: `Git ${operation.type}`,
          reason: `Run ${commandText(args)}.`,
          risk,
          action: requiredApprovalAction,
          details: {
            kind: "git_mutation",
            operationHash,
            operation,
            preview,
          },
        })
      : undefined,
    preview,
  };
}

export async function applyGitMutation(input: {
  cwd: string;
  taskId: string;
  operation: GitMutationOperation;
  approvalId: string;
}): Promise<AppliedGitMutation> {
  const prepared = await prepareGitMutation({
    cwd: input.cwd,
    taskId: input.taskId,
    operation: input.operation,
  });
  const approval = requireApprovedApproval(input.approvalId);
  if (approval.action !== prepared.requiredApprovalAction) {
    throw new Error("Approval does not match this Git mutation.");
  }
  const result = await runGit(input.cwd, gitMutationArgs(prepared.operation));
  return {
    ...prepared,
    applied: true,
    result,
  };
}

export async function getGitRoot(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  const result = await runGit(cwd, ["status", "--short", "--branch"]);
  const parsed = parseGitStatusOutput(result.stdout);
  return {
    ...result,
    ...parsed,
  };
}

export async function getGitDiff(cwd: string): Promise<GitCommandResult> {
  return runGit(cwd, ["diff", "--", "."]);
}

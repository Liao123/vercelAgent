/**
 * Shell 审批暂停时的 Loop 检查点（A151 Phase B：同 thread 内 tool_result 续跑）。
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import type { AgentMessage, AgentUiContext } from "@/agent/types";

export type PendingShellApproval = {
  toolCallId: string;
  toolName: string;
  approvalId: string;
  command: string;
};

export type LoopShellCheckpoint = {
  threadId: string;
  taskId: string;
  savedAt: string;
  iteration: number;
  maxIterations: number;
  effectiveUserRequest: string;
  messages: AgentMessage[];
  runState: AgentLoopRunState;
  pendingShell: PendingShellApproval;
  uiContext?: AgentUiContext;
};

const STATE_DIR = ".agent-state";
const CHECKPOINT_FILE = "loop-shell-checkpoints.json";

type CheckpointStore = Record<string, LoopShellCheckpoint>;

function storePath(): string {
  return path.join(process.cwd(), STATE_DIR, CHECKPOINT_FILE);
}

function readStore(): CheckpointStore {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    return JSON.parse(raw) as CheckpointStore;
  } catch {
    return {};
  }
}

function writeStore(store: CheckpointStore): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

export function isShellLoopResumeEnabled(): boolean {
  return process.env.AGENT_LOOP_SHELL_RESUME !== "0";
}

export function saveLoopShellCheckpoint(checkpoint: LoopShellCheckpoint): void {
  const store = readStore();
  store[checkpoint.threadId] = checkpoint;
  writeStore(store);
}

export function getLoopShellCheckpoint(
  threadId: string,
): LoopShellCheckpoint | null {
  return readStore()[threadId] ?? null;
}

export function clearLoopShellCheckpoint(threadId: string): void {
  const store = readStore();
  if (!(threadId in store)) return;
  delete store[threadId];
  writeStore(store);
}

export function consumeLoopShellCheckpoint(
  threadId: string,
  approvalId: string,
): LoopShellCheckpoint | null {
  const checkpoint = getLoopShellCheckpoint(threadId);
  if (!checkpoint) return null;
  if (checkpoint.pendingShell.approvalId !== approvalId) return null;
  clearLoopShellCheckpoint(threadId);
  return checkpoint;
}

export function hasLoopShellCheckpoint(
  threadId: string,
  approvalId?: string,
): boolean {
  const checkpoint = getLoopShellCheckpoint(threadId);
  if (!checkpoint) return false;
  if (approvalId && checkpoint.pendingShell.approvalId !== approvalId) {
    return false;
  }
  return true;
}

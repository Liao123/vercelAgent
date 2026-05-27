/**
 * Agent 核心领域类型。
 *
 * 这里定义 Thread / Task / Turn / Event / Plan 等跨模块共享结构。
 * 后续 UI、API route、trace、工具系统都应该引用这些类型，避免各写一套。
 */
export type AgentId = string;

export type AgentStatus =
  | "created"
  | "planning"
  | "waiting_for_approval"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRole = "system" | "user" | "assistant" | "tool";

export type AgentTextContent = string;

export type AgentImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
};

export type AgentTextContentPart = {
  type: "text";
  text: string;
};

export type AgentContent =
  | AgentTextContent
  | Array<AgentTextContentPart | AgentImageContentPart>;

export type AgentMessage = {
  role: AgentRole;
  content: AgentContent;
  name?: string;
};

export type AgentPlanStepStatus =
  | "todo"
  | "doing"
  | "blocked"
  | "done"
  | "skipped";

export type AgentPlanStep = {
  id: string;
  title: string;
  status: AgentPlanStepStatus;
  notes?: string;
};

export type AgentPlan = {
  goal: string;
  steps: AgentPlanStep[];
  risks: string[];
  verification: string[];
  updatedAt: string;
};

export type Thread = {
  id: AgentId;
  workspaceId: AgentId;
  title: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export type Task = {
  id: AgentId;
  threadId: AgentId;
  workspaceId: AgentId;
  userRequest: string;
  status: AgentStatus;
  plan?: AgentPlan;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
};

export type Turn = {
  id: AgentId;
  threadId: AgentId;
  taskId?: AgentId;
  userInput: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalContentSnapshot = {
  text: string;
  length: number;
  lineCount: number;
  truncated: boolean;
};

export type ApprovalFileMutationOperation =
  | {
      type: "create";
      path: string;
      content: string;
      overwrite?: boolean;
    }
  | {
      type: "write";
      path: string;
      content: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "rename";
      fromPath: string;
      toPath: string;
      overwrite?: boolean;
    };

export type ApprovalFileMutationPreview = {
  type: ApprovalFileMutationOperation["type"];
  path?: string;
  fromPath?: string;
  toPath?: string;
  existsBefore: boolean;
  existsAfter: boolean;
  oldSize?: number;
  newSize?: number;
  sizeDelta?: number;
  oldContent?: ApprovalContentSnapshot;
  newContent?: ApprovalContentSnapshot;
};

export type ApprovalGitMutationOperation =
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

export type ApprovalGitMutationPreview = {
  command: string;
  risk: ApprovalRisk;
  notes: string[];
};

export type ApprovalDetails =
  | {
      kind: "file_mutation";
      operationHash: string;
      operation: ApprovalFileMutationOperation;
      preview: ApprovalFileMutationPreview;
    }
  | {
      kind: "git_mutation";
      operationHash: string;
      operation: ApprovalGitMutationOperation;
      preview: ApprovalGitMutationPreview;
    };

export type ApprovalExecution = {
  status: "succeeded" | "failed";
  attemptedAt: string;
  summary: string;
  error?: string;
  result?: unknown;
};

export type ApprovalRequest = {
  id: AgentId;
  taskId: AgentId;
  title: string;
  reason: string;
  risk: ApprovalRisk;
  action: string;
  createdAt: string;
  details?: ApprovalDetails;
  execution?: ApprovalExecution;
};

export type ToolCallRecord = {
  id: AgentId;
  taskId?: AgentId;
  toolName: string;
  args: unknown;
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export type VerificationResult = {
  command: string;
  success: boolean;
  output: string;
  completedAt: string;
};

/** Agent Loop 反思检查点，供 UI 展示「想清楚了没有」。 */
export type AgentReflection = {
  understanding: string;
  blockers: string[];
  plannedNext: string;
  source: "model" | "runtime";
};

export type AgentEvent =
  | { type: "thread.created"; threadId: string; thread: Thread }
  | { type: "task.created"; taskId: string; task: Task }
  | { type: "turn.created"; turnId: string; turn: Turn }
  | { type: "plan.updated"; taskId: string; plan: AgentPlan }
  | { type: "model.delta"; taskId: string; text: string }
  | { type: "tool.started"; taskId: string; toolCall: ToolCallRecord }
  | {
      type: "tool.completed";
      taskId: string;
      toolCall: ToolCallRecord;
      result: unknown;
    }
  | { type: "approval.required"; taskId: string; approval: ApprovalRequest }
  | { type: "file.changed"; taskId: string; filePath: string; diff: string }
  | {
      type: "verification.completed";
      taskId: string;
      result: VerificationResult;
    }
  | { type: "context.compacted"; taskId: string; summaryId: string }
  | {
      type: "reflection.updated";
      taskId: string;
      reflection: AgentReflection;
    }
  | { type: "task.completed"; taskId: string; task: Task; summary: string }
  | { type: "task.failed"; taskId: string; task?: Task; error: string };

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

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
  /** 最近一次上下文压缩后的滚动记忆摘要（预览） */
  contextSummary?: string;
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
  /** 聚焦片段在完整文件中的起始行号（1-based），用于 diff 行号对齐。 */
  startLine?: number;
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

/** prepare 时磁盘依据：exact 匹配片段 + 行号（A077）。 */
export type ApprovalPrepareEvidence = {
  path: string;
  startLine: number;
  endLine: number;
  matchedSnippet: string;
  searchText?: string;
  source: "file.replace.prepare" | "file.mutation.prepare";
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

export type ApprovalGitStatusSnapshot = {
  dirty: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  detached: boolean;
  files: Array<{
    path: string;
    previousPath?: string;
    indexStatus: string;
    worktreeStatus: string;
    status:
      | "modified"
      | "added"
      | "deleted"
      | "renamed"
      | "copied"
      | "untracked"
      | "conflicted";
  }>;
  summary: string;
};

export type ApprovalGitWorkspaceSnapshot = {
  branch?: string;
  status?: ApprovalContentSnapshot;
  /** 结构化 git status，供 UI 与模型准确理解 dirty 文件列表。 */
  statusSnapshot?: ApprovalGitStatusSnapshot;
  diff?: ApprovalContentSnapshot;
  remoteUrl?: string;
};

export type ApprovalGitMutationPreview = {
  command: string;
  risk: ApprovalRisk;
  notes: string[];
  /** commit/push 等操作执行前的工作区快照。 */
  workspace?: ApprovalGitWorkspaceSnapshot;
};

export type ApprovalShellScript = "lint" | "build" | "test" | "typecheck";

export type ApprovalShellMutationPreview = {
  command: string;
  risk: ApprovalRisk;
  notes: string[];
  script: ApprovalShellScript;
  available: boolean;
};

export type ApprovalPatchFilePreview = {
  filePath: string;
  oldPath?: string;
  newPath?: string;
  kind?: "modify" | "create" | "delete" | "rename";
  changed: boolean;
  oldContent?: ApprovalContentSnapshot;
  newContent?: ApprovalContentSnapshot;
};

export type ApprovalPatchPreview = {
  fileCount: number;
  changedCount: number;
  files: ApprovalPatchFilePreview[];
  patchPreview: ApprovalContentSnapshot;
};

export type ApprovalDetails =
  | {
      kind: "file_mutation";
      operationHash: string;
      operation: ApprovalFileMutationOperation;
      preview: ApprovalFileMutationPreview;
      evidence?: ApprovalPrepareEvidence;
    }
  | {
      kind: "git_mutation";
      operationHash: string;
      operation: ApprovalGitMutationOperation;
      preview: ApprovalGitMutationPreview;
    }
  | {
      kind: "patch_apply";
      operationHash: string;
      /** 完整 patch，供 execute 使用。 */
      patch: string;
      preview: ApprovalPatchPreview;
    }
  | {
      kind: "shell_command";
      operationHash: string;
      operation: { type: "npm_script"; script: ApprovalShellScript };
      preview: ApprovalShellMutationPreview;
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
  /** 模型调用工具前的简短意图说明（中文） */
  rationale?: string;
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
  | { type: "trace.linked"; taskId: string; traceId: string }
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
  | {
      type: "context.compacted";
      taskId: string;
      summaryId: string;
      method?: "deterministic" | "semantic";
      estimatedTokensBefore?: number;
      estimatedTokensAfter?: number;
      round?: number;
      middleMessageCount?: number;
      summaryPreview?: string;
      memoryContent?: string;
      threadId?: string;
      pinnedApprovalCount?: number;
      changedFileCount?: number;
    }
  | {
      type: "reflection.updated";
      taskId: string;
      reflection: AgentReflection;
      at?: string;
    }
  | { type: "task.completed"; taskId: string; task: Task; summary: string }
  | { type: "task.failed"; taskId: string; task?: Task; error: string };

/** Agent 产品 UI 运行时上下文（由前端传入 Loop，非用户 workspace 代码）。 */
export type AgentUiLayout = "default" | "workspace" | "triple";

export type AgentUiContext = {
  /** 当前 Agent Workspace 布局；triple 时 RunMode 在 agent-composer。 */
  layout?: AgentUiLayout;
  /** 用户当前查看的路由，默认 `/`。 */
  activeRoute?: string;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

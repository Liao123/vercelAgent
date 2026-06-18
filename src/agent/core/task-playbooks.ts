/**
 * 任务剧本：单 Agent Loop 内的「黄金路径 + 熔断 + 轮次预算」（对齐 browser-doc 提速模式）。
 */
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  isExplicitReadOnlyRequest,
  isLikelyCodeEditRequest,
} from "@/agent/core/agent-loop-state";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";

export type TaskPlaybookId =
  | "browser-doc"
  | "ui-visible-edit"
  | "file-exact-edit"
  | "read-only-audit"
  | "code-edit-general"
  | "default";

export type PlaybookCircuitBreaker = {
  tool: string;
  threshold: number;
  redirectTool: string;
  message: string;
  understanding: string;
  plannedNext: string;
};

export type PlaybookGoldenStep = {
  id: string;
  label: string;
  tools: string[];
};

export type TaskPlaybook = {
  id: TaskPlaybookId;
  title: string;
  openingPlannedNext: string;
  loopHint?: string;
  softMaxToolRounds: number;
  goldenSteps: PlaybookGoldenStep[];
  circuitBreakers: PlaybookCircuitBreaker[];
};

export type ResolvedTaskPlaybook = TaskPlaybook & {
  matchReason: string;
};

export function isBrowserDocAnalysisRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const hasUrl = /https?:\/\//i.test(text) || /apifox/i.test(text);
  const docIntent =
    /解析|接口参数|api\s*参数|文档|openapi|swagger|整理.*参数/i.test(text);
  return hasUrl && docIntent;
}

function matchesUiVisibleEdit(input: string): boolean {
  if (isExplicitReadOnlyRequest(input)) return false;
  if (!isLikelyCodeEditRequest(input)) return false;
  return isUiLocationQuery(input);
}

function matchesFileExactEdit(input: string): boolean {
  if (isExplicitReadOnlyRequest(input)) return false;
  if (!isLikelyCodeEditRequest(input)) return false;
  if (isUiLocationQuery(input)) return false;
  return /src\/[^\s]+\.(tsx?|jsx?|vue)/i.test(input) || /\.tsx?['"`\s]/i.test(input);
}

function matchesReadOnlyAudit(input: string): boolean {
  if (!isExplicitReadOnlyRequest(input)) return false;
  return true;
}

const BROWSER_DOC: TaskPlaybook = {
  id: "browser-doc",
  title: "外链 / API 文档解析",
  openingPlannedNext:
    "browser.wait_and_inspect 或 browser.open → browser.inspect → 直接中文 final；不要反复 Network。",
  loopHint:
    "【任务提示】解析网页/API 文档（只读）。优先 browser.wait_and_inspect 或 browser.open + browser.inspect；拿到正文后直接中文整理参数，避免重复 devtools.get_network_requests。",
  softMaxToolRounds: 4,
  goldenSteps: [
    { id: "open", label: "打开并读取页面", tools: ["browser.wait_and_inspect", "browser.open", "browser.inspect"] },
    { id: "final", label: "整理中文结果", tools: [] },
  ],
  circuitBreakers: [
    {
      tool: "devtools.get_network_requests",
      threshold: 2,
      redirectTool: "browser.inspect",
      message:
        "devtools.get_network_requests 已连续失败。请改用 browser.inspect 读取页面正文并直接给出中文整理结果，不要再调 Network。",
      understanding: "Network 工具不可用，应改用 browser.inspect。",
      plannedNext: "调用 browser.inspect 后在本轮或下一轮直接输出最终整理结果。",
    },
  ],
};

const UI_VISIBLE_EDIT: TaskPlaybook = {
  id: "ui-visible-edit",
  title: "界面可见文案 / 组件修改",
  openingPlannedNext:
    "ui.trace_from_page（或 file.locate）→ jsx.find_text → file.read → file.replace；不要先 file.search 绕路。",
  loopHint:
    "【任务提示】UI 改文案/去按钮：先 ui.trace_from_page 或 file.locate 定位组件，再 jsx.find_text 找可见文案，file.read 取 exact 子串后 file.replace；4～6 步内完成 prepare。",
  softMaxToolRounds: 6,
  goldenSteps: [
    { id: "trace", label: "定位 UI 组件", tools: ["ui.trace_from_page", "file.locate"] },
    { id: "jsx", label: "查找可见文案", tools: ["jsx.find_text"] },
    { id: "read", label: "读取源文件", tools: ["file.read"] },
    { id: "write", label: "准备或应用变更", tools: ["file.replace", "file.replace.prepare", "file.mutation.prepare", "patch.apply", "patch.prepare"] },
  ],
  circuitBreakers: [
    {
      tool: "file.search",
      threshold: 2,
      redirectTool: "jsx.find_text",
      message:
        "file.search 连续无有效结果。UI 任务请改用 ui.trace_from_page + jsx.find_text 定位可见文案。",
      understanding: "file.search 不适合 UI 文案定位。",
      plannedNext: "调用 ui.trace_from_page 或 jsx.find_text，再 file.read。",
    },
    {
      tool: "file.locate",
      threshold: 3,
      redirectTool: "ui.trace_from_page",
      message:
        "file.locate 多次未收敛。请改用 ui.trace_from_page（triple 布局）或 jsx.find_text。",
      understanding: "定位未收敛，应换 UI 追踪路径。",
      plannedNext: "ui.trace_from_page → jsx.find_text → file.read。",
    },
  ],
};

const FILE_EXACT_EDIT: TaskPlaybook = {
  id: "file-exact-edit",
  title: "指定文件精确修改",
  openingPlannedNext: "file.read 确认原文 → file.replace（精确子串）或 file.replace.prepare。",
  loopHint:
    "【任务提示】已指明文件路径：先 file.read，再用磁盘 exact 子串 file.replace；避免无目标 file.search。",
  softMaxToolRounds: 5,
  goldenSteps: [
    { id: "read", label: "读取文件", tools: ["file.read"] },
    { id: "write", label: "替换或审批", tools: ["file.replace", "file.replace.prepare", "file.mutation.prepare"] },
  ],
  circuitBreakers: [
    {
      tool: "file.replace.prepare",
      threshold: 2,
      redirectTool: "file.read",
      message:
        "file.replace.prepare 连续失败。请重新 file.read 复制 exact search 子串后再 prepare。",
      understanding: "prepare 的 search 与磁盘不一致。",
      plannedNext: "file.read 后使用读到的 exact 行作为 search。",
    },
  ],
};

const READ_ONLY_AUDIT: TaskPlaybook = {
  id: "read-only-audit",
  title: "只读分析",
  openingPlannedNext: "project.index / file.locate → file.read → 直接中文总结；不调用写盘工具。",
  loopHint: "【任务提示】只读任务：取证后直接中文 final，不要 file.replace / prepare。",
  softMaxToolRounds: 6,
  goldenSteps: [
    { id: "gather", label: "定位与读取", tools: ["project.index", "file.locate", "file.read", "file.search", "git.status", "git.diff"] },
    { id: "final", label: "总结交付", tools: [] },
  ],
  circuitBreakers: [],
};

const CODE_EDIT_GENERAL: TaskPlaybook = {
  id: "code-edit-general",
  title: "代码修改",
  openingPlannedNext: "project.index / file.locate → file.read → file.replace 或 prepare 审批。",
  loopHint: undefined,
  softMaxToolRounds: 8,
  goldenSteps: [
    { id: "gather", label: "定位并读取", tools: ["project.index", "file.locate", "file.read", "file.search"] },
    { id: "write", label: "变更或审批", tools: ["file.replace", "file.replace.prepare", "patch.apply", "patch.prepare"] },
  ],
  circuitBreakers: [],
};

const DEFAULT_PLAYBOOK: TaskPlaybook = {
  id: "default",
  title: "通用任务",
  openingPlannedNext: "先用工具在磁盘上核实假设，再决定是否准备代码变更审批。",
  softMaxToolRounds: 10,
  goldenSteps: [],
  circuitBreakers: [],
};

const ORDERED_PLAYBOOKS: Array<{
  playbook: TaskPlaybook;
  match: (input: string, state: AgentLoopRunState) => boolean;
  reason: string;
}> = [
  {
    playbook: BROWSER_DOC,
    match: (input) => isBrowserDocAnalysisRequest(input),
    reason: "外链/API 文档解析",
  },
  {
    playbook: READ_ONLY_AUDIT,
    match: (input) => matchesReadOnlyAudit(input),
    reason: "用户声明只读",
  },
  {
    playbook: UI_VISIBLE_EDIT,
    match: (input) => matchesUiVisibleEdit(input),
    reason: "UI 可见元素修改",
  },
  {
    playbook: FILE_EXACT_EDIT,
    match: (input) => matchesFileExactEdit(input),
    reason: "路径明确的代码修改",
  },
  {
    playbook: CODE_EDIT_GENERAL,
    match: (input) => isLikelyCodeEditRequest(input),
    reason: "代码修改意图",
  },
];

export function resolveTaskPlaybook(
  userRequest: string,
  state?: AgentLoopRunState,
): ResolvedTaskPlaybook {
  const input = state?.userRequest ?? userRequest;
  for (const entry of ORDERED_PLAYBOOKS) {
    if (entry.match(input, state ?? createMinimalState(input))) {
      return { ...entry.playbook, matchReason: entry.reason };
    }
  }
  return { ...DEFAULT_PLAYBOOK, matchReason: "默认" };
}

function createMinimalState(userRequest: string): AgentLoopRunState {
  return {
    userRequest,
    likelyEditRequest: isLikelyCodeEditRequest(userRequest),
    approvalPrepared: false,
    toolsCalled: [],
    filesRead: [],
    reflectionRounds: 0,
  };
}

export function findCircuitBreaker(
  playbook: TaskPlaybook,
  toolName: string,
  streak: { tool: string; count: number } | undefined,
): PlaybookCircuitBreaker | null {
  if (!streak || streak.tool !== toolName) return null;
  return (
    playbook.circuitBreakers.find(
      (rule) => rule.tool === toolName && streak.count >= rule.threshold,
    ) ?? null
  );
}

export function countToolRounds(toolsCalled: string[]): number {
  return toolsCalled.length;
}

export type PlaybookProgress = {
  completedStepIds: string[];
  currentStepId: string | null;
  currentStepLabel: string | null;
  stepLabels: string[];
  completedCount: number;
  totalSteps: number;
  progressLabel: string;
};

export function computePlaybookProgress(
  playbook: TaskPlaybook,
  toolsCalled: string[],
): PlaybookProgress {
  const steps = playbook.goldenSteps;
  if (steps.length === 0) {
    return {
      completedStepIds: [],
      currentStepId: null,
      currentStepLabel: null,
      stepLabels: [],
      completedCount: 0,
      totalSteps: 0,
      progressLabel: playbook.title,
    };
  }

  const completedStepIds: string[] = [];
  let currentStepId: string | null = steps[0]?.id ?? null;
  let currentStepLabel: string | null = steps[0]?.label ?? null;

  for (const step of steps) {
    const done = step.tools.some((tool) => toolsCalled.includes(tool));
    if (done) {
      completedStepIds.push(step.id);
    }
  }

  for (const step of steps) {
    if (!completedStepIds.includes(step.id)) {
      currentStepId = step.id;
      currentStepLabel = step.label;
      break;
    }
    currentStepId = null;
    currentStepLabel = null;
  }

  const completedCount = completedStepIds.length;
  const totalSteps = steps.length;
  const progressLabel =
    completedCount >= totalSteps
      ? `${playbook.title} · 路径已完成`
      : currentStepLabel
        ? `${playbook.title} · ${currentStepLabel}`
        : playbook.title;

  return {
    completedStepIds,
    currentStepId,
    currentStepLabel,
    stepLabels: steps.map((s) => s.label),
    completedCount,
    totalSteps,
    progressLabel,
  };
}

export function buildSoftRoundBudgetHint(
  playbook: TaskPlaybook,
  toolRounds: number,
): string | null {
  if (toolRounds < playbook.softMaxToolRounds) return null;
  if (playbook.id === "browser-doc") {
    return "【轮次提示】文档任务已达建议工具轮次。请根据已有 browser 快照直接输出中文 final，不要再调工具。";
  }
  if (playbook.id === "ui-visible-edit") {
    return "【轮次提示】UI 任务已达建议轮次。请 file.read 后 file.replace/prepare，或总结阻塞原因。";
  }
  return "【轮次提示】已达建议工具轮次。请总结当前证据并给出 final 或明确阻塞。";
}

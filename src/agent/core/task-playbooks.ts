/**
 * 任务剧本：软加速器（UI 进度 + loopHint），runtime 不拦截工具路由。
 */
import type { TaskReasoning } from "@/agent/core/loop-reasoning";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  isExplicitReadOnlyRequest,
  isLikelyCodeEditRequest,
} from "@/agent/core/agent-loop-state";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";
import { hasPageUiDeliverable } from "@/agent/core/loop-deliverable";

export type TaskPlaybookId =
  | "browser-doc"
  | "design-replicate"
  | "capability-extension"
  | "dev-run"
  | "screenshot-save"
  | "ui-visible-edit"
  | "file-exact-edit"
  | "read-only-audit"
  | "code-edit-general"
  | "default";

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

/** A024：demo URL + 复刻/生成页面意图（非 API 文档解析）。 */
export function isDesignReplicateRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (isBrowserDocAnalysisRequest(text)) return false;
  if (isExplicitReadOnlyRequest(text)) return false;
  const hasUrl = /https?:\/\//i.test(text);
  const replicateIntent =
    /复刻|照着|模仿|还原|仿照|clone|replicat|照着.*做|生成.*页|做一?个.*页|landing|设计稿|design\s*spec|页面复刻|网页复刻/i.test(
      text,
    );
  const buildIntent =
    isLikelyCodeEditRequest(text) ||
    /生成|创建|实现|写到/i.test(text) ||
    /src\/[^\s]+\.(tsx?|jsx?|vue)/i.test(text);
  return hasUrl && replicateIntent && buildIntent;
}

/** 截图并保存到桌面/指定路径（环境任务，优先 CDP / MCP）。 */
export function isScreenshotSaveRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (!/截图|screenshot|截屏/i.test(text)) return false;
  return (
    /桌面|desktop|保存|save|filePath|存到|保存为/i.test(text) ||
    /截图到/.test(text)
  );
}

/** 启动 dev / 验证项目能否跑起来（只跑命令，不改代码）。 */
export function isDevRunRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (isExplicitReadOnlyRequest(text)) return false;
  if (isCapabilityExtensionRequest(text)) return false;
  if (isBrowserDocAnalysisRequest(text)) return false;
  if (isDesignReplicateRequest(text)) return false;
  if (isLikelyCodeEditRequest(text) && /src\/[^\s]+\.(tsx?|jsx?)/i.test(text)) {
    return false;
  }
  return (
    /npm\s+run\s+dev\b/i.test(text) ||
    /\bdev(?::desktop)?\b/i.test(text) ||
    /(跑|启动|开|起|运行).{0,12}(dev|开发服|本地服|项目)/i.test(text) ||
    /(dev|开发服).{0,12}(能跑|能否|能不能|跑起来|跑吗|启动)/i.test(text) ||
    /跑起来了吗|能跑起来吗|跑一下\s*dev/i.test(text)
  );
}

/** Agent 内核 / 工具链自举扩展（改 src/agent + 跑 validate）。 */
export function isCapabilityExtensionRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (isExplicitReadOnlyRequest(text)) return false;
  return (
    /扩展.*能力|自举|自我扩展|加.*工具|shell\.run|agent-loop-tools|缺少.*命令|终端能力|命令行能力|capability[- ]extension/i.test(
      text,
    ) &&
    (/src\/agent|agent-loop-tools|shell-tools|validate:|verify:/i.test(text) ||
      /实现|添加|支持|对齐.*cursor/i.test(text))
  );
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
};

const DESIGN_REPLICATE: TaskPlaybook = {
  id: "design-replicate",
  title: "Demo 页面复刻",
  openingPlannedNext:
    "browser.open(demo URL) → devtools.extract_design_spec → devtools.get_persisted_design_spec → file.mutation/prepare 写 index.html+CSS+JS → browser.open 本地验证。",
  loopHint:
    "【软提示】页面复刻：结合 WORKSPACE_STRUCTURE 与用户目标 URL，自行推导取证、脚手架（若需要）与写盘顺序。",
  softMaxToolRounds: 10,
  goldenSteps: [
    {
      id: "open-demo",
      label: "打开 demo 页",
      tools: ["browser.open", "browser.wait_and_inspect"],
    },
    {
      id: "extract",
      label: "抽取 design spec",
      tools: ["devtools.extract_design_spec"],
    },
    {
      id: "read-code",
      label: "读取目标代码",
      tools: ["project.index", "file.locate", "file.search", "file.read"],
    },
    {
      id: "write",
      label: "修改页面代码",
      tools: [
        "file.replace",
        "file.replace.prepare",
        "file.mutation.prepare",
        "patch.apply",
        "patch.prepare",
      ],
    },
    {
      id: "verify",
      label: "浏览器验证",
      tools: [
        "browser.open",
        "browser.inspect",
        "browser.wait_and_inspect",
        "devtools.get_screenshot",
      ],
    },
  ],
};

const SCREENSHOT_SAVE: TaskPlaybook = {
  id: "screenshot-save",
  title: "截图保存到磁盘",
  openingPlannedNext:
    "agent.diagnose（若 MCP/CDP 不明）→ devtools.get_screenshot 或 mcp.*.take_screenshot，filePath 用 desktop:name.jpg。",
  loopHint:
    "【任务提示】截图到桌面：先 agent.diagnose 确认 CDP/MCP；优先 devtools.get_screenshot（filePath: desktop:xxx.jpg）。MCP take_screenshot 失败立即改内置，不要结束。需 npm run dev:desktop 且浏览器 Tab 已打开页面。",
  softMaxToolRounds: 6,
  goldenSteps: [
    { id: "diagnose", label: "环境诊断", tools: ["agent.diagnose"] },
    {
      id: "capture",
      label: "截图并写盘",
      tools: ["devtools.get_screenshot", "mcp.chrome-devtools.take_screenshot"],
    },
  ],
};

const DEV_RUN: TaskPlaybook = {
  id: "dev-run",
  title: "启动开发服务",
  openingPlannedNext:
    "file.read package.json scripts（可选）→ shell.run.prepare `npm run dev` → 根据输出判断成功/失败；失败时换端口或确认已在运行。",
  loopHint:
    "【任务提示】启动 dev：优先 shell.run.prepare `npm run dev`。失败后按输出分层处理：已在运行→直接汇报 URL；端口冲突→换端口重试；超时/无输出→检查日志后重试。命令失败禁止只 final，必须给出下一条可执行命令（需用户批准）。",
  softMaxToolRounds: 8,
  goldenSteps: [
    {
      id: "inspect",
      label: "确认 dev 脚本",
      tools: ["file.read", "project.index"],
    },
    {
      id: "run",
      label: "准备运行 dev",
      tools: ["shell.run.prepare", "shell.command.prepare"],
    },
    {
      id: "recover",
      label: "失败则换端口或诊断",
      tools: ["shell.run.prepare", "shell.command.prepare"],
    },
    { id: "final", label: "汇报 URL 或阻塞原因", tools: [] },
  ],
};

const CAPABILITY_EXTENSION: TaskPlaybook = {
  id: "capability-extension",
  title: "Agent 能力自举扩展",
  openingPlannedNext:
    "file.read 相关内核文件 → file.replace/patch.apply 改工具注册 → shell.run.prepare 跑 validate → 中文说明是否需重启 dev。",
  loopHint:
    "【任务提示】扩展 Agent 能力：先 agent.bootstrap.check 确认路径与 validate 脚本 → file.read 内核文件 → 改代码 → shell.run.prepare 跑 npm run validate:*；改 Loop/MCP 后提醒重启 npm run dev 或 dev:desktop。禁止改 .env。",
  softMaxToolRounds: 12,
  goldenSteps: [
    {
      id: "read-kernel",
      label: "检查自举策略并读取内核",
      tools: ["agent.bootstrap.check", "file.read", "file.search", "file.locate", "project.index"],
    },
    {
      id: "edit-kernel",
      label: "修改工具/策略代码",
      tools: [
        "file.replace",
        "file.mutation",
        "patch.apply",
        "file.replace.prepare",
        "patch.prepare",
      ],
    },
    {
      id: "verify",
      label: "审批并运行验证命令",
      tools: ["shell.run.prepare", "shell.command.prepare"],
    },
    {
      id: "final",
      label: "总结与重启提示",
      tools: [],
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
};

const DEFAULT_PLAYBOOK: TaskPlaybook = {
  id: "default",
  title: "通用任务",
  openingPlannedNext: "先理解用户意图，再按需取证；避免无关工具。",
  softMaxToolRounds: 10,
  goldenSteps: [],
};

const PLAYBOOKS: Record<TaskPlaybookId, TaskPlaybook> = {
  "browser-doc": BROWSER_DOC,
  "design-replicate": DESIGN_REPLICATE,
  "capability-extension": CAPABILITY_EXTENSION,
  "dev-run": DEV_RUN,
  "screenshot-save": SCREENSHOT_SAVE,
  "ui-visible-edit": UI_VISIBLE_EDIT,
  "file-exact-edit": FILE_EXACT_EDIT,
  "read-only-audit": READ_ONLY_AUDIT,
  "code-edit-general": CODE_EDIT_GENERAL,
  default: DEFAULT_PLAYBOOK,
};

export function getPlaybookById(id: TaskPlaybookId): TaskPlaybook {
  return PLAYBOOKS[id] ?? DEFAULT_PLAYBOOK;
}

/** 推理完成后按 intent 绑定 playbook（非句式硬路由）。 */
export function inferPlaybookIdFromReasoning(
  reasoning: TaskReasoning,
  userRequest: string,
): TaskPlaybookId {
  const text = userRequest.trim();
  if (reasoning.intent === "meta") return "default";
  if (isBrowserDocAnalysisRequest(text)) return "browser-doc";
  if (matchesReadOnlyAudit(text)) return "read-only-audit";
  if (reasoning.intent === "shell") {
    return isDevRunRequest(text) ? "dev-run" : "code-edit-general";
  }
  if (reasoning.intent === "browser") {
    return "default";
  }
  if (
    reasoning.intent === "code_edit" ||
    reasoning.risk === "write" ||
    reasoning.risk === "approval_required"
  ) {
    if (isScreenshotSaveRequest(text)) return "screenshot-save";
    if (isCapabilityExtensionRequest(text)) return "capability-extension";
    if (isDesignReplicateRequest(text)) return "design-replicate";
    if (isDevRunRequest(text)) return "dev-run";
    if (matchesUiVisibleEdit(text)) return "ui-visible-edit";
    if (matchesFileExactEdit(text)) return "file-exact-edit";
    return "code-edit-general";
  }
  if (reasoning.intent === "qa" || reasoning.intent === "analysis") {
    if (isBrowserDocAnalysisRequest(text)) return "browser-doc";
    return "default";
  }
  return "default";
}

export function bootstrapPlaybookId(userRequest: string): TaskPlaybookId {
  if (matchesReadOnlyAudit(userRequest)) return "read-only-audit";
  return "default";
}

export function resolveTaskPlaybook(
  userRequest: string,
  state?: AgentLoopRunState,
): ResolvedTaskPlaybook {
  const input = state?.userRequest ?? userRequest;
  const id = state?.taskReasoning
    ? inferPlaybookIdFromReasoning(state.taskReasoning, input)
    : bootstrapPlaybookId(input);
  const playbook = getPlaybookById(id);
  const matchReason = state?.taskReasoning
    ? `推理 intent=${state.taskReasoning.intent}`
    : id === "read-only-audit"
      ? "用户声明只读"
      : "默认（推理后细化）";
  return { ...playbook, matchReason };
}

/** 软加速器 hint：仅当前 playbook 一条，不堆叠多条硬提示。 */
export function collectPlaybookAcceleratorHints(
  userRequest: string,
  state?: AgentLoopRunState,
): string[] {
  const resolved = resolveTaskPlaybook(userRequest, state);
  return resolved.loopHint ? [resolved.loopHint] : [];
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

/** @deprecated 仅 validate 保留句式探测；runtime 用 inferPlaybookIdFromReasoning。 */
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
    playbook: DESIGN_REPLICATE,
    match: (input) => isDesignReplicateRequest(input),
    reason: "demo 页面复刻",
  },
  {
    playbook: SCREENSHOT_SAVE,
    match: (input) => isScreenshotSaveRequest(input),
    reason: "截图保存到桌面",
  },
  {
    playbook: CAPABILITY_EXTENSION,
    match: (input) => isCapabilityExtensionRequest(input),
    reason: "Agent 能力自举扩展",
  },
  {
    playbook: DEV_RUN,
    match: (input) => isDevRunRequest(input),
    reason: "启动 dev / 验证能否跑起来",
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

export function detectPlaybookIdFromRequest(
  userRequest: string,
  state?: AgentLoopRunState,
): TaskPlaybookId {
  const input = state?.userRequest ?? userRequest;
  for (const entry of ORDERED_PLAYBOOKS) {
    if (entry.match(input, state ?? createMinimalState(input))) {
      return entry.playbook.id;
    }
  }
  return "default";
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
  filesWritten: string[] = [],
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
    let done = step.tools.some((tool) => toolsCalled.includes(tool));
    if (step.id === "write" && playbook.id === "design-replicate") {
      done = hasPageUiDeliverable({
        filesWritten,
        editApplied: filesWritten.length > 0,
      } as AgentLoopRunState);
    }
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


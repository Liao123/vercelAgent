/**
 * 任务剧本：软加速器（hint + 熔断 + 轮次预算），不替模型定路由。
 */
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  isExplicitReadOnlyRequest,
  isLikelyCodeEditRequest,
} from "@/agent/core/agent-loop-state";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";

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

const DESIGN_REPLICATE: TaskPlaybook = {
  id: "design-replicate",
  title: "Demo 页面复刻",
  openingPlannedNext:
    "browser.open(demo URL) → devtools.extract_design_spec → file.read → file.replace/prepare → browser.open 本地页验证。",
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
  circuitBreakers: [
    {
      tool: "devtools.extract_design_spec",
      threshold: 2,
      redirectTool: "file.read",
      message:
        "design spec 已抽取并落盘。请根据 summary 修改代码，不要重复 extract_design_spec。",
      understanding: "重复抽取 design spec 无助于写码。",
      plannedNext: "file.read 目标页面 → file.replace/prepare → browser.open 验证。",
    },
    {
      tool: "browser.inspect",
      threshold: 4,
      redirectTool: "devtools.extract_design_spec",
      message:
        "复刻任务应先 devtools.extract_design_spec 拿结构化布局/样式，browser.inspect 仅用于最终验证。",
      understanding: "缺少结构化 design spec。",
      plannedNext: "browser.open demo URL → devtools.extract_design_spec。",
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
  circuitBreakers: [
    {
      tool: "mcp.chrome-devtools.take_screenshot",
      threshold: 1,
      redirectTool: "devtools.get_screenshot",
      message:
        "MCP 截图失败或未连接，请立即改用 devtools.get_screenshot 并传 filePath（desktop:name.jpg）。",
      understanding: "MCP 浏览器工具不可用。",
      plannedNext:
        "devtools.get_screenshot { filePath: 'desktop:shot.jpg' }；仍失败则 agent.diagnose。",
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
  circuitBreakers: [
    {
      tool: "shell.run.prepare",
      threshold: 2,
      redirectTool: "file.read",
      message:
        "dev 命令连续 prepare 仍未成功。请先 file.read package.json 确认 dev 脚本，再 prepare 带 --port 的命令。",
      understanding: "可能脚本名或端口策略不对。",
      plannedNext:
        "file.read package.json → shell.run.prepare 带 `--port` 的 dev 命令。",
    },
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
  circuitBreakers: [
    {
      tool: "shell.run.prepare",
      threshold: 3,
      redirectTool: "file.read",
      message:
        "shell 命令多次未通过。请先 file.read 确认 package.json scripts 与改动是否正确，再 prepare 正确的 validate 命令。",
      understanding: "验证命令或改动可能不正确。",
      plannedNext: "file.read package.json 与改动文件 → 修正 → shell.run.prepare。",
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
  openingPlannedNext: "先理解用户意图，再按需取证；避免无关工具。",
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

/** 软加速器 hint（可多条），不替模型定路由。 */
export function collectPlaybookAcceleratorHints(
  userRequest: string,
  state?: AgentLoopRunState,
): string[] {
  const input = state?.userRequest ?? userRequest;
  const minimal = state ?? createMinimalState(input);
  const hints: string[] = [];
  for (const entry of ORDERED_PLAYBOOKS) {
    if (entry.match(input, minimal) && entry.playbook.loopHint) {
      hints.push(entry.playbook.loopHint);
    }
  }
  return hints;
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

const DESIGN_SPEC_TOOLS = new Set([
  "devtools.extract_design_spec",
  "devtools.get_persisted_design_spec",
]);

const DESIGN_REPLICATE_DISCOURAGED_BEFORE_SPEC = new Set([
  "devtools.get_accessibility_tree",
  "devtools.new_page",
  "file.replace",
  "file.replace.prepare",
  "file.mutation",
  "file.mutation.prepare",
  "patch.apply",
  "patch.prepare",
]);

export type PlaybookToolRedirect = {
  redirectTool: string;
  message: string;
  understanding: string;
  plannedNext: string;
};

/** @deprecated 软提示数据保留供 UI/文档；runtime 不再拦截工具调用。 */
export function findPlaybookToolRedirect(
  playbook: TaskPlaybook,
  toolName: string,
  toolsCalled: string[],
): PlaybookToolRedirect | null {
  if (playbook.id !== "design-replicate") return null;
  if (DESIGN_SPEC_TOOLS.has(toolName)) return null;
  if (!DESIGN_REPLICATE_DISCOURAGED_BEFORE_SPEC.has(toolName)) return null;
  if (toolsCalled.some((tool) => DESIGN_SPEC_TOOLS.has(tool))) return null;

  return {
    redirectTool: "devtools.extract_design_spec",
    message:
      "design-replicate 任务应先 devtools.extract_design_spec，再改代码；不要跳过 design spec 直接写盘或用 a11y tree。",
    understanding: "缺少 design spec，无法稳定复刻布局与样式。",
    plannedNext:
      "browser.open demo URL（若尚未打开）→ devtools.extract_design_spec → file.read 目标页面文件。",
  };
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
  if (playbook.id === "design-replicate") {
    return "【轮次提示】复刻任务已达建议轮次。请根据 design spec 完成 file.replace/prepare，并 browser.open 本地页验证。";
  }
  if (playbook.id === "ui-visible-edit") {
    return "【轮次提示】UI 任务已达建议轮次。请 file.read 后 file.replace/prepare，或总结阻塞原因。";
  }
  return "【轮次提示】已达建议工具轮次。请总结当前证据并给出 final 或明确阻塞。";
}

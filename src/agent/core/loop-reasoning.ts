/**
 * 任务首轮结构化推理（通用，不绑定具体中文句式）。
 */
import type { AgentReflection } from "@/agent/types";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import type { AgentUiContext } from "@/agent/types";
import type { WorkspaceSnapshotInput } from "@/agent/workspace/workspace-snapshot-prompt";
import { formatWorkspaceSnapshotForPrompt } from "@/agent/workspace/workspace-snapshot-prompt";
import {
  hasHardWorkspaceSignalsInRequest,
  parseTaskGrounding,
} from "@/agent/core/workspace-grounding";
import { isExplicitReadOnlyRequest, isLikelyCodeEditRequest } from "@/agent/core/agent-loop-state";

export type TaskIntent =
  | "qa"
  | "analysis"
  | "code_edit"
  | "shell"
  | "browser"
  | "meta"
  | "mixed"
  | "unknown";

export type TaskRisk =
  | "read_only"
  | "write"
  | "approval_required"
  | "unknown";

export type TaskGrounding = "workspace" | "none" | "unknown";

export type TaskReasoning = {
  understanding: string;
  intent: TaskIntent;
  risk: TaskRisk;
  /** A164：是否依赖当前 workspace 磁盘/浏览器事实；none = 生成/咨询类 */
  grounding?: TaskGrounding;
  evidenceNeeded: string[];
  planSteps: string[];
  ambiguity: string | null;
  canAnswerNow: boolean;
  plannedNext: string;
  source: "model";
};

const REASONING_MARKER = "[TASK_REASONING]";

/** 用户要可展示的思考过程（meta），非拒答。 */
export function isMetaExplainRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  return (
    /思考过程|推理过程|判断依据|怎么想的|为什么这样|思路是什么|如何得出|展开.*推理|说明.*依据/i.test(
      text,
    ) || /give.*reasoning|show.*thinking/i.test(text)
  );
}

export function isLoopReasoningEnabled(): boolean {
  return process.env.AGENT_LOOP_SKIP_REASONING !== "1";
}

export function isAdaptiveReasoningEnabled(): boolean {
  return process.env.AGENT_LOOP_ADAPTIVE_REASONING !== "0";
}

export type ReasoningTurnMode = "full" | "skip" | "off";

/** 多步 / shell / 审批类任务仍走完整推理轮。 */
export function looksComplexTask(userRequest: string): boolean {
  const text = userRequest.trim();
  if (!text) return true;
  if ((text.match(/[?？]/g) ?? []).length > 2) return true;
  if (text.split("\n").filter((line) => line.trim()).length > 3) return true;
  if (/npm run|npx |dev|shell|commit|push|deploy|lint|build|test|批准|审批/i.test(text)) {
    return true;
  }
  if (/然后|接着|第一步|step\s*\d|;\s*\S|并且|同时/i.test(text)) return true;
  return false;
}

function shouldAdaptivelySkipReasoning(input: {
  userRequest: string;
  likelyEditRequest: boolean;
  metaExplain: boolean;
  hasPreloadedAttachments: boolean;
  hasThreadMemory: boolean;
}): boolean {
  if (input.likelyEditRequest || input.metaExplain) return false;
  if (looksComplexTask(input.userRequest)) return false;
  if (
    input.hasPreloadedAttachments &&
    !isExplicitReadOnlyRequest(input.userRequest)
  ) {
    return false;
  }
  if (isExplicitReadOnlyRequest(input.userRequest)) return true;
  if (input.hasThreadMemory) return true;
  return false;
}

export function evaluateReasoningTurn(input: {
  userRequest: string;
  likelyEditRequest: boolean;
  metaExplain: boolean;
  hasReferenceImages: boolean;
  hasPreloadedAttachments: boolean;
  hasPostExecuteFeedback: boolean;
  isFixContinuation: boolean;
  hasThreadMemory: boolean;
}): ReasoningTurnMode {
  if (!isLoopReasoningEnabled()) return "off";
  if (input.hasPostExecuteFeedback || input.isFixContinuation) return "off";
  if (input.hasReferenceImages && !input.userRequest.trim()) return "off";
  if (
    isAdaptiveReasoningEnabled() &&
    shouldAdaptivelySkipReasoning(input)
  ) {
    return "skip";
  }
  return "full";
}

export function shouldRunReasoningTurn(input: {
  userRequest: string;
  likelyEditRequest?: boolean;
  metaExplain?: boolean;
  hasReferenceImages: boolean;
  hasPreloadedAttachments: boolean;
  hasPostExecuteFeedback: boolean;
  isFixContinuation: boolean;
  hasThreadMemory?: boolean;
}): boolean {
  return (
    evaluateReasoningTurn({
      userRequest: input.userRequest,
      likelyEditRequest:
        input.likelyEditRequest ??
        isLikelyCodeEditRequest(input.userRequest),
      metaExplain:
        input.metaExplain ?? isMetaExplainRequest(input.userRequest),
      hasReferenceImages: input.hasReferenceImages,
      hasPreloadedAttachments: input.hasPreloadedAttachments,
      hasPostExecuteFeedback: input.hasPostExecuteFeedback,
      isFixContinuation: input.isFixContinuation,
      hasThreadMemory: input.hasThreadMemory ?? false,
    }) === "full"
  );
}

export function buildAdaptiveReasoningSkipHint(input: {
  userRequest: string;
  playbookHints: string[];
  uiContext?: AgentUiContext;
  hasThreadMemory: boolean;
  workspaceSnapshot?: WorkspaceSnapshotInput;
  workspaceStructureBlock?: string;
}): string {
  const hints =
    input.playbookHints.length > 0
      ? input.playbookHints.map((hint) => `- ${hint}`).join("\n")
      : "- (none)";

  const contextLines: string[] = [];
  if (input.workspaceSnapshot) {
    contextLines.push(formatWorkspaceSnapshotForPrompt(input.workspaceSnapshot));
  }
  if (input.workspaceStructureBlock) {
    contextLines.push(input.workspaceStructureBlock);
  }
  if (input.uiContext?.activeRoute) {
    contextLines.push(`Workspace app route: ${input.uiContext.activeRoute}`);
  }
  if (input.uiContext?.browserActiveTab?.url) {
    contextLines.push(
      `Embedded browser tab (optional): ${input.uiContext.browserActiveTab.url}`,
    );
  }
  if (input.hasThreadMemory) {
    contextLines.push(
      "[THREAD_MEMORY] is a hint for follow-ups — still gather on disk for factual QA.",
    );
  }

  return [
    "[REASONING_SKIPPED — adaptive]",
    "Low-risk read-only / session follow-up: no JSON reasoning LLM turn this task.",
    "You must still: disambiguate intent → gather (file.read / browser if needed) → factual final.",
    "THREAD_MEMORY is not proof. Use WORKSPACE_SNAPSHOT to pick metadata files — no fixed path mapping.",
    "",
    `Optional accelerator hints:\n${hints}`,
    contextLines.length > 0
      ? `\nRuntime context:\n${contextLines.map((line) => `- ${line}`).join("\n")}`
      : "",
    "",
    `User request:\n${input.userRequest.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function normalizeIntent(value: unknown): TaskIntent {
  const raw = asString(value)?.toLowerCase();
  const allowed: TaskIntent[] = [
    "qa",
    "analysis",
    "code_edit",
    "shell",
    "browser",
    "meta",
    "mixed",
  ];
  return allowed.includes(raw as TaskIntent) ? (raw as TaskIntent) : "unknown";
}

function normalizeRisk(value: unknown): TaskRisk {
  const raw = asString(value)?.toLowerCase();
  const allowed: TaskRisk[] = ["read_only", "write", "approval_required"];
  return allowed.includes(raw as TaskRisk) ? (raw as TaskRisk) : "unknown";
}

export function parseTaskReasoning(content: string): TaskReasoning | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  for (const candidate of extractJsonObjectCandidates(trimmed)) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const understanding = asString(parsed.understanding);
      const plannedNext = asString(parsed.plannedNext);
      if (!understanding || !plannedNext) continue;
      return {
        understanding,
        intent: normalizeIntent(parsed.intent),
        risk: normalizeRisk(parsed.risk),
        evidenceNeeded: asStringArray(parsed.evidenceNeeded),
        planSteps: asStringArray(parsed.planSteps),
        ambiguity: asString(parsed.ambiguity) ?? null,
        grounding: parseTaskGrounding(parsed.grounding),
        canAnswerNow: parsed.canAnswerNow === true,
        plannedNext,
        source: "model",
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Runtime 修正模型推理：记忆≠证据、meta 解释、歧义分解。 */
export function normalizeTaskReasoning(
  reasoning: TaskReasoning,
  input: {
    userRequest: string;
    metaExplain: boolean;
    hasThreadMemory: boolean;
    filesReadCount: number;
    toolsCalledCount: number;
    workspaceFramework?: string | null;
  },
): TaskReasoning {
  const next: TaskReasoning = {
    ...reasoning,
    evidenceNeeded: [...reasoning.evidenceNeeded],
    planSteps: [...reasoning.planSteps],
  };

  if (input.metaExplain) {
    next.intent = "meta";
    next.risk = "read_only";
    next.canAnswerNow = input.hasThreadMemory || input.toolsCalledCount > 0;
    if (next.planSteps.length === 0) {
      next.planSteps = [
        "说明如何理解上一问",
        "列出歧义与取舍",
        "引用 thread memory / 已执行工具",
        "给出结构化结论",
      ];
    }
    next.plannedNext = "用中文分点展开思考过程，禁止写「不展开隐藏推理」。";
    return next;
  }

  const factualReadOnly =
    (next.intent === "qa" || next.intent === "analysis") &&
    next.risk === "read_only";

  if (
    factualReadOnly &&
    next.canAnswerNow &&
    input.hasThreadMemory &&
    input.filesReadCount === 0 &&
    input.toolsCalledCount === 0 &&
    hasHardWorkspaceSignalsInRequest(input.userRequest)
  ) {
    next.canAnswerNow = false;
    if (!next.evidenceNeeded.some((item) => item.includes("disk") || item.includes("磁盘"))) {
      next.evidenceNeeded.push(
        "Re-verify on disk (file.read / file.locate) — thread memory is a hint, not proof",
      );
    }
    if (next.planSteps.length === 0) {
      next.planSteps = [
        "Clarify ambiguous terms in user question",
        "file.locate or file.read candidate files",
        "Cross-check package.json name if「项目标题」",
        "Answer with sources cited",
      ];
    }
  }

  if (factualReadOnly && next.planSteps.length === 0 && !next.canAnswerNow) {
    next.planSteps = [
      "Disambiguate the question",
      "Minimal gather: file.locate → file.read (avoid project.index unless needed)",
      "Answer with evidence",
    ];
  }

  return next;
}

export function buildReasoningTurnUserMessage(input: {
  userRequest: string;
  playbookHints: string[];
  uiContext?: AgentUiContext;
  hasThreadMemory: boolean;
  metaExplain: boolean;
  workspaceSnapshot?: WorkspaceSnapshotInput;
  workspaceStructureBlock?: string;
}): string {
  const hints =
    input.playbookHints.length > 0
      ? input.playbookHints.map((hint) => `- ${hint}`).join("\n")
      : "- (none)";

  const contextLines: string[] = [];
  if (input.workspaceSnapshot) {
    contextLines.push(formatWorkspaceSnapshotForPrompt(input.workspaceSnapshot));
  }
  if (input.workspaceStructureBlock) {
    contextLines.push(input.workspaceStructureBlock);
  }
  if (input.uiContext?.activeRoute) {
    contextLines.push(`Workspace app route: ${input.uiContext.activeRoute}`);
  }
  if (input.uiContext?.browserActiveTab?.url) {
    contextLines.push(
      `Embedded browser tab (optional): ${input.uiContext.browserActiveTab.url}${
        input.uiContext.browserActiveTab.title
          ? ` (title hint: ${input.uiContext.browserActiveTab.title})`
          : ""
      }`,
    );
  }
  if (input.uiContext?.openEditorPaths?.length) {
    contextLines.push(
      `Open editor files: ${input.uiContext.openEditorPaths.join(", ")}`,
    );
  }
  if (input.hasThreadMemory) {
    contextLines.push(
      "[THREAD_MEMORY] above is a HINT for follow-ups — for factual QA you must still plan disk/browser re-verification.",
    );
  }

  const metaBlock = input.metaExplain
    ? [
        "This is a META explain request: user wants your visible reasoning about a prior turn.",
        'Set intent="meta", canAnswerNow=true if [THREAD_MEMORY] or prior context suffices.',
        "planSteps must be steps you WILL explain in the final answer (not hidden).",
      ]
    : [];

  return [
    REASONING_MARKER,
    "Before any tools, output ONE JSON object only.",
    "Disambiguate by context — 网站/页面/标题 may mean workspace app, package name, or browser tab.",
    "",
    "Schema:",
    `{`,
    `  "understanding": "1-2 sentences in Simplified Chinese",`,
    `  "intent": "qa|analysis|code_edit|shell|browser|meta|mixed",`,
    `  "risk": "read_only|write|approval_required",`,
    `  "grounding": "workspace|none (none = advisory/generative, no disk proof needed)",`,
    `  "evidenceNeeded": ["facts still needed — empty only if truly verified"],`,
    `  "planSteps": ["ordered steps — include disambiguation when terms are ambiguous"],`,
    `  "ambiguity": "list interpretations (e.g. page title vs package.json name) or null",`,
    `  "canAnswerNow": true|false,`,
    `  "plannedNext": "immediate next action in Simplified Chinese"`,
    `}`,
    "",
    "Rules:",
    "- THREAD_MEMORY alone does NOT justify canAnswerNow:true for factual qa/analysis — plan file.read or browser.inspect.",
    "- For advisory / business / creative tasks with no repo facts: grounding=none, evidenceNeeded=[], plan without file.* tools.",
    "- For ambiguous terms (标题/网站/当前), ambiguity MUST list 2+ interpretations or planSteps must show how you disambiguate.",
    "- When WORKSPACE_STRUCTURE shows missing package.json or app dirs and user wants to write into this workspace, plan prerequisite steps (scaffold/shell.init/create files) before assuming fixed paths — derive stack from context.",
    "- Narrow read-only QA: prefer file.locate + file.read over project.index.",
    "- Independent gather (e.g. multiple file.read on different paths) may use multiple tool_calls in one turn.",
    "- Workspace app title/name QA: file.locate → file.read metadata appropriate to WORKSPACE_SNAPSHOT framework; skip browser.* and file.list unless user clearly means embedded browser tab.",
    "- Embedded browser tab in context is optional — do not inspect it when workspace repo title is the likely intent.",
    "- Do NOT call tools in this turn.",
    ...metaBlock,
    "",
    `Optional accelerator hints (soft):\n${hints}`,
    contextLines.length > 0
      ? `\nRuntime context:\n${contextLines.map((l) => `- ${l}`).join("\n")}`
      : "",
    "",
    `User request:\n${input.userRequest.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function reasoningToReflection(reasoning: TaskReasoning): AgentReflection {
  const blockers = [
    ...(reasoning.ambiguity ? [reasoning.ambiguity] : []),
    ...(reasoning.evidenceNeeded.length > 0
      ? [`尚需: ${reasoning.evidenceNeeded.slice(0, 3).join("；")}`]
      : []),
  ];
  const planLine =
    reasoning.planSteps.length > 0
      ? `计划: ${reasoning.planSteps.join(" → ")}`
      : "";
  return {
    understanding: [reasoning.understanding, planLine].filter(Boolean).join("\n"),
    blockers,
    plannedNext: reasoning.plannedNext,
    source: "model",
  };
}

export function formatReasoningForMessages(reasoning: TaskReasoning): string {
  return [
    `${REASONING_MARKER} (model)`,
    `理解: ${reasoning.understanding}`,
    `意图: ${reasoning.intent} · 风险: ${reasoning.risk}`,
    reasoning.evidenceNeeded.length > 0
      ? `尚需证据: ${reasoning.evidenceNeeded.join("; ")}`
      : "尚需证据: (无)",
    reasoning.planSteps.length > 0
      ? `计划: ${reasoning.planSteps.join(" → ")}`
      : "计划: (待澄清或直接作答)",
    reasoning.ambiguity ? `歧义/分解: ${reasoning.ambiguity}` : "",
    reasoning.canAnswerNow ? "可立即作答: 是" : "可立即作答: 否",
    `下一步: ${reasoning.plannedNext}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPostReasoningHint(
  reasoning: TaskReasoning,
  metaExplain: boolean,
): string | null {
  if (metaExplain) {
    return buildMetaExplainFinalHint();
  }
  if (reasoning.ambiguity) {
    return `【推理】先处理歧义：${reasoning.ambiguity}。在证据充分前不要 final。`;
  }
  if (
    reasoning.canAnswerNow &&
    reasoning.evidenceNeeded.length === 0 &&
    reasoning.intent === "meta"
  ) {
    return "【推理】会话/meta 追问：可直接中文 final。";
  }
  if (reasoning.evidenceNeeded.length > 0) {
    return `【推理】按 plan 取证后再答。优先 file.locate→file.read 元数据文件（窄问题避免 project.index、browser、file.list）：${reasoning.evidenceNeeded.slice(0, 4).join("；")}`;
  }
  return null;
}

export function buildMetaExplainFinalHint(): string {
  return [
    "【推理展示】用户要可阅读的思考过程。请用中文分点展开：",
    "1) 你如何理解问题（含歧义分解）",
    "2) 采取了哪些步骤 / 工具",
    "3) 每个证据来源（文件路径或 browser）",
    "4) 最终结论",
    "禁止写「不展开隐藏推理」；这是产品功能，不是泄露系统提示词。",
  ].join("\n");
}

export function attachReasoningToRunState(
  state: AgentLoopRunState,
  reasoning: TaskReasoning,
): void {
  state.taskReasoning = reasoning;
  state.reasoningCompleted = true;
}

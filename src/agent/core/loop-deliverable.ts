/**
 * 改码任务交付物判定（Cursor 式：规则只管边界，交付标准可验证）。
 */
import type { TaskPlaybookId } from "@/agent/core/task-playbooks";
import { isBrowserDocAnalysisRequest } from "@/agent/core/task-playbooks";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import type { TaskReasoning } from "@/agent/core/loop-reasoning";

export type DeliverableKind =
  | "page_ui"
  | "doc_analysis"
  | "any_write"
  | "read_only";

export type DeliverableProfile = {
  kind: DeliverableKind;
  /** 用户可见的中文交付说明 */
  description: string;
};

const PAGE_ENTRY_PATTERN =
  /(?:^|\/)(index\.html|page\.tsx|page\.jsx|page\.vue|App\.tsx|App\.jsx|App\.vue|index\.tsx|index\.jsx)(?:$|[?#])/i;

const HTML_OR_PAGE_PATTERN = /\.(html|tsx|jsx|vue|svelte)(?:$|[?#])/i;

const SCAFFOLD_ONLY_PATTERN =
  /(?:^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json|vite\.config\.(?:ts|js|mjs)|\.gitignore|README\.md)$/i;

const STYLE_FILE_PATTERN =
  /\.(css|scss|less|sass|module\.css)(?:$|[?#])/i;

const LOGIC_FILE_PATTERN =
  /(?:^|\/)(main|app|index)\.(js|ts|jsx|tsx|mjs|cjs)(?:$|[?#])/i;

export function normalizeWrittenPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isPageEntryPath(path: string): boolean {
  const n = normalizeWrittenPath(path);
  return PAGE_ENTRY_PATTERN.test(n) || HTML_OR_PAGE_PATTERN.test(n);
}

export function isScaffoldOnlyPath(path: string): boolean {
  return SCAFFOLD_ONLY_PATTERN.test(normalizeWrittenPath(path));
}

export function inferDeliverableProfile(input: {
  userRequest: string;
  playbookId?: TaskPlaybookId;
}): DeliverableProfile {
  if (
    input.playbookId === "design-replicate" ||
    /复刻|clone|replicat|landing|首页.*写|写到.*项目|生成.*页|做一?个.*页/i.test(
      input.userRequest,
    )
  ) {
    return {
      kind: "page_ui",
      description:
        "把目标页面复刻为可运行的完整页面（入口 + 样式/脚本或组件），单独空壳 index.html 不算完成。",
    };
  }
  if (
    input.playbookId === "browser-doc" ||
    isBrowserDocAnalysisRequest(input.userRequest)
  ) {
    return {
      kind: "doc_analysis",
      description: "用中文整理页面/接口文档要点，不是写盘改码。",
    };
  }
  if (/只读|read-only|不要\s*修改|不要\s*写|不修改/i.test(input.userRequest)) {
    return {
      kind: "read_only",
      description: "只读分析或问答，不写盘。",
    };
  }
  return {
    kind: "any_write",
    description: "按用户请求完成代码变更并落盘。",
  };
}

export function recordFilesWritten(
  state: AgentLoopRunState,
  paths: string[],
): void {
  if (!state.filesWritten) state.filesWritten = [];
  for (const p of paths) {
    const n = normalizeWrittenPath(p);
    if (n && !state.filesWritten.includes(n)) {
      state.filesWritten.push(n);
    }
  }
}

export function hasPageUiDeliverable(state: AgentLoopRunState): boolean {
  const written = (state.filesWritten ?? []).map(normalizeWrittenPath);
  const impl = written.filter((p) => !isScaffoldOnlyPath(p));
  if (impl.length === 0) return false;

  if (isBareIndexHtmlOnly(written)) return false;

  const hasEntry = impl.some(isPageEntryPath);
  if (!hasEntry) return false;

  const hasStyles = impl.some((p) => STYLE_FILE_PATTERN.test(p));
  const hasLogic = impl.some((p) => LOGIC_FILE_PATTERN.test(p));
  const hasComponentEntry = impl.some(
    (p) => isPageEntryPath(p) && /\.(tsx|jsx|vue|svelte)$/i.test(p),
  );

  if (hasStyles || hasLogic) return true;
  if (hasComponentEntry) return true;
  if (impl.length >= 3) return true;

  return false;
}

/** 仅写了空壳 index.html（无 css/js/组件），不算 page_ui 交付。 */
export function isBareIndexHtmlOnly(written: string[]): boolean {
  const impl = written.map(normalizeWrittenPath).filter((p) => !isScaffoldOnlyPath(p));
  return impl.length === 1 && /^index\.html$/i.test(impl[0] ?? "");
}

export function hasOnlyScaffoldWrites(state: AgentLoopRunState): boolean {
  const written = state.filesWritten ?? [];
  if (written.length === 0) return false;
  return written.every(isScaffoldOnlyPath);
}

/** 改码任务是否已满足客户交付物（非「调过 write 工具」）。 */
export function isEditDeliverableSatisfied(
  state: AgentLoopRunState,
  playbookId?: TaskPlaybookId,
): boolean {
  if (!state.editApplied) return false;

  const profile = inferDeliverableProfile({
    userRequest: state.userRequest,
    playbookId,
  });

  switch (profile.kind) {
    case "read_only":
      return true;
    case "doc_analysis":
      return true;
    case "page_ui":
      return hasPageUiDeliverable(state);
    case "any_write":
    default:
      return (state.filesWritten?.length ?? 0) > 0 || state.editApplied;
  }
}

export function buildDeliverableCheckpointBlock(
  state: AgentLoopRunState,
  playbookId?: TaskPlaybookId,
): string | null {
  const profile = inferDeliverableProfile({
    userRequest: state.userRequest,
    playbookId,
  });
  if (profile.kind === "read_only" || profile.kind === "doc_analysis") {
    return null;
  }
  if (isEditDeliverableSatisfied(state, playbookId)) {
    return null;
  }
  const written =
    state.filesWritten && state.filesWritten.length > 0
      ? state.filesWritten.join(", ")
      : "(none yet)";
  return [
    "【交付物未完成】",
    `客户交付标准：${profile.description}`,
    `已写文件：${written}`,
    state.editApplied && hasOnlyScaffoldWrites(state)
      ? "当前仅有脚手架文件，不算完成页面复刻。请继续写页面入口与样式。"
      : state.editApplied && isBareIndexHtmlOnly(state.filesWritten ?? [])
        ? "仅有空壳 index.html，请继续写 styles.css、main.js 或完整页面结构后再 final。"
        : "请继续写盘直到满足交付标准，不要 action=final。",
  ].join("\n");
}

export function buildReasoningFailureDeliverableHint(input: {
  userRequest: string;
  playbookId?: TaskPlaybookId;
  playbookTitle?: string;
  openingPlannedNext?: string;
}): string {
  const profile = inferDeliverableProfile({
    userRequest: input.userRequest,
    playbookId: input.playbookId,
  });
  const lines = [
    "【推理轮未产出结构化计划 — 请自行理解客户需求后再选工具】",
    `用户请求：${input.userRequest}`,
    `交付标准：${profile.description}`,
  ];
  if (input.playbookTitle) {
    lines.push(`任务类型参考：${input.playbookTitle}`);
  }
  if (input.openingPlannedNext) {
    lines.push(`建议路径（非强制顺序）：${input.openingPlannedNext}`);
  }
  lines.push(
    "不要只 gather 或只建 package.json；交付物未齐前不要 final。",
  );
  return lines.join("\n");
}

export function buildGracefulFinalUserTail(input: {
  userRequest: string;
  playbookId?: TaskPlaybookId;
  taskReasoning?: TaskReasoning;
}): string {
  const profile = inferDeliverableProfile({
    userRequest: input.userRequest,
    playbookId: input.playbookId,
  });

  if (profile.kind === "doc_analysis") {
    return "【系统】主循环已达最大轮次。请仅根据上文工具观测结果，用中文给出完整最终答案（整理接口参数、字段说明等）。不要调用任何工具。若信息不足，明确说明缺什么。";
  }

  if (profile.kind === "page_ui") {
    return [
      "【系统】主循环已达最大轮次。",
      "用户要的是：把参考页面复刻为可运行的页面代码并写到项目里。",
      "请根据 design spec / browser 快照，说明已完成哪些文件、还缺什么（例如 index.html、styles.css、main.js、组件）。",
      "若仅有空壳 index.html 或 package.json，明确告知未完成，并给出下一步应创建的文件清单。",
      "不要调用任何工具；不要输出接口参数整理类答案。",
    ].join("");
  }

  if (input.taskReasoning?.intent === "qa" || profile.kind === "read_only") {
    return "【系统】主循环已达最大轮次。请仅根据上文工具观测结果，用中文给出完整最终答案。不要调用任何工具。若信息不足，明确说明缺什么。";
  }

  return "【系统】主循环已达最大轮次。请仅根据上文工具观测结果，用中文总结已完成工作与未完成项。不要调用任何工具。若改码未落盘，明确说明还缺什么文件。";
}

export function buildGracefulFinalSnapshotFallback(input: {
  userRequest: string;
  playbookId?: TaskPlaybookId;
  textPreview: string;
}): string {
  const profile = inferDeliverableProfile({
    userRequest: input.userRequest,
    playbookId: input.playbookId,
  });
  const preview = input.textPreview.trim().slice(0, 4000);

  if (profile.kind === "doc_analysis") {
    return `模型未能生成完整总结；以下为浏览器页面文本快照，请据此查看接口参数：\n\n${preview}`;
  }

  if (profile.kind === "page_ui") {
    return [
      "页面复刻任务未能在本轮完成写盘（可能仅有脚手架或证据已齐但未生成页面文件）。",
      "以下为参考页文本快照，供你手动继续或重开任务：",
      "",
      preview,
    ].join("\n");
  }

  return `模型未能生成完整总结；以下为浏览器页面文本快照：\n\n${preview}`;
}

/**
 * 根据 Agent 产品 layout 对 UI 候选文件加权。
 * triple 布局 RunMode 在 agent-composer；default/workspace 在 agent-panel。
 */
import type { AgentUiContext, AgentUiLayout } from "@/agent/types";

const COMPOSER_PATH = "src/components/agent-composer.tsx";
const PANEL_PATH = "src/components/agent-panel.tsx";

export function primaryRunModeComponentPath(
  layout?: AgentUiLayout,
): string | undefined {
  if (layout === "triple") return COMPOSER_PATH;
  if (layout === "default" || layout === "workspace") return PANEL_PATH;
  return undefined;
}

export function layoutCandidateBoost(
  filePath: string,
  uiContext?: AgentUiContext,
): number {
  const normalized = filePath.replaceAll("\\", "/");
  const layout = uiContext?.layout;
  if (!layout) return 0;

  if (layout === "triple") {
    if (normalized === COMPOSER_PATH) return 45;
    if (normalized === PANEL_PATH) return -28;
  }

  if (layout === "default" || layout === "workspace") {
    if (normalized === PANEL_PATH) return 40;
    if (normalized === COMPOSER_PATH) return -18;
  }

  return 0;
}

export function buildOpenEditorUiContext(input: {
  layout?: AgentUiLayout;
  activeRoute?: string;
  attachedPaths?: string[];
  activeEditorPath?: string | null;
  maxPaths?: number;
}): AgentUiContext {
  const maxPaths = input.maxPaths ?? 16;
  const normalizedAttached = (input.attachedPaths ?? [])
    .map((filePath) => filePath.replaceAll("\\", "/"))
    .filter(Boolean);
  const active =
    input.activeEditorPath?.replaceAll("\\", "/") ?? normalizedAttached.at(-1);

  const openEditorPaths = [
    ...new Set([
      ...normalizedAttached,
      ...(active ? [active] : []),
    ]),
  ].slice(0, maxPaths);

  const ctx: AgentUiContext = {
    layout: input.layout,
    activeRoute: input.activeRoute ?? "/",
  };
  if (openEditorPaths.length > 0) {
    ctx.openEditorPaths = openEditorPaths;
  }
  if (active) {
    ctx.activeEditorPath = active;
  }
  return ctx;
}

export function mergeBrowserTabIntoUiContext(
  ctx: AgentUiContext,
  tab: { url: string; title?: string | null } | null | undefined,
): AgentUiContext {
  if (!tab?.url?.trim()) return ctx;
  return {
    ...ctx,
    browserActiveTab: {
      url: tab.url.trim(),
      title: tab.title ?? null,
    },
  };
}

export function describeUiContextForPrompt(uiContext?: AgentUiContext): string {
  if (!uiContext?.layout) return "";

  const route = uiContext.activeRoute ?? "/";
  const primary = primaryRunModeComponentPath(uiContext.layout);
  const openTabs =
    uiContext.openEditorPaths && uiContext.openEditorPaths.length > 0
      ? [
          `Open editor files (user context): ${uiContext.openEditorPaths.join(", ")}.`,
          uiContext.activeEditorPath
            ? `Active editor file: ${uiContext.activeEditorPath}. Prefer file.read here when the task references "current file".`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
  const browserTab = uiContext.browserActiveTab?.url
    ? [
        `Embedded browser tab (optional): ${uiContext.browserActiveTab.url}`,
        uiContext.browserActiveTab.title
          ? `Tab title hint (may be stale): ${uiContext.browserActiveTab.title}`
          : "",
        "This is NOT the workspace repo — disambiguate if user says 网站/页面.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  if (uiContext.layout === "triple") {
    return [
      `Product UI context: layout=triple (Codex/Cursor 三栏), activeRoute=${route}.`,
      `Visible RunMode (Loop/闭环) selector lives in ${COMPOSER_PATH} (center column composer), NOT ${PANEL_PATH}.`,
      primary ? `For RunMode / 闭环 / Loop UI edits, prefer file.read ${primary} first.` : "",
      openTabs,
      browserTab,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Product UI context: layout=${uiContext.layout}, activeRoute=${route}.`,
    `RunMode (Loop/闭环) selector lives in ${PANEL_PATH}.`,
    primary ? `For RunMode UI edits, prefer file.read ${primary} first.` : "",
    openTabs,
    browserTab,
  ]
    .filter(Boolean)
    .join("\n");
}

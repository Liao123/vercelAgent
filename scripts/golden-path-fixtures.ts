/**
 * 离线黄金路径 / 消歧 / prepare 回归共用 fixture（handoff P0：侧栏加号）。
 *
 * 闭环/Loop 主路径 UI 已移除（A100）；用侧栏「项目行 ＋ 新建会话」替代。
 */
export const GOLDEN_UI_QUERY =
  "去掉项目行右侧的加号，侧栏新建会话按钮不要显示加号";

/** A024：demo 页面复刻黄金路径 fixture */
export const GOLDEN_DESIGN_REPLICATE_QUERY =
  "照着 https://example.com 复刻一个 landing 页面到 src/app/demo-replicate/page.tsx";

export const DEMO_REPLICATE_PAGE_PATH = "src/app/demo-replicate/page.tsx";

export const SIDEBAR_PATH = "src/components/agent-session-sidebar.tsx";
export const PANEL_PATH = "src/components/agent-panel.tsx";
export const COMPOSER_PATH = "src/components/agent-composer.tsx";

/** sidebar.tsx 中项目行 ＋ 按钮的 exact 子串（含缩进） */
export const SIDEBAR_PLUS_LINE = "                      +";

export const GOLDEN_UI_CONTEXT = {
  layout: "triple" as const,
  activeRoute: "/",
};

export const GOLDEN_DISAMBIGUATION_LABEL = "新建 Agent";

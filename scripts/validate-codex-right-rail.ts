/**
 * Codex-like right rail: launcher + opened surfaces + environment popover.
 *
 * 运行：npm run validate:codex-right-rail
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const rightRail = await read("src/components/agent-right-rail.tsx");
  const browserPanel = await read("src/components/browser-panel.tsx");
  const reviewPanel = await read("src/components/agent-review-panel.tsx");
  const terminalPanel = await read("src/components/agent-terminal-panel.tsx");
  const agentPanel = await read("src/components/agent-panel.tsx");

  assert.ok(
    rightRail.includes("AgentRightRailContextSummary"),
    "right rail exposes context summary type",
  );
  assert.ok(
    rightRail.includes('role="tablist"') &&
      rightRail.includes('aria-label="右侧面板"'),
    "right rail owns one Codex-like top tab strip",
  );
  assert.ok(
    rightRail.includes('export type AgentRightRailTab = AgentRightRailSurface | "launcher"') &&
      rightRail.includes('useState<AgentRightRailSurface[]>([])') &&
      rightRail.includes('if (tab === "launcher") return') &&
      rightRail.includes("openedTabs.map"),
    "right rail uses a launcher state and only renders opened surfaces as tabs",
  );
  assert.ok(
    rightRail.includes("function closeSurface") &&
      rightRail.includes("aria-label={`关闭 ${label}`}") &&
      rightRail.includes("closeSurface(surface)"),
    "opened surface tabs expose a close action like Codex desktop tabs",
  );
  assert.ok(
    rightRail.includes("onOpenReview?: () => void") &&
      rightRail.includes('surface === "review" && onOpenReview') &&
      agentPanel.includes("const openReviewPanel = useCallback") &&
      agentPanel.includes("onOpenReview={openReviewPanel}"),
    "review tab opens through an explicit review surface action",
  );
  const openedTabsIndex = rightRail.indexOf("openedTabs.map");
  const plusIndex = rightRail.indexOf("<BrowserPlusIcon", openedTabsIndex);
  const envIndex = rightRail.indexOf("<EnvironmentIcon", openedTabsIndex);
  assert.ok(
    openedTabsIndex >= 0 && plusIndex > openedTabsIndex && plusIndex < envIndex,
    "the add-tab button sits beside opened tabs before right-side controls",
  );
  assert.ok(
    rightRail.includes("SurfaceLauncherPopover") &&
      rightRail.includes("SurfaceLauncherView") &&
      rightRail.includes("SurfaceLauncherList") &&
      rightRail.includes("打开面板"),
    "right rail exposes surfaces through a launcher popover/view",
  );
  assert.ok(
    rightRail.includes('label: "审查"') &&
      rightRail.includes('label: "终端"') &&
      rightRail.includes('label: "浏览器"') &&
      rightRail.includes('label: "文件"') &&
      rightRail.includes('label: "侧边聊天"'),
    "launcher lists Codex-like side surface entries",
  );
  assert.ok(
    rightRail.includes('fallbackLabel: "新选项卡"') &&
      rightRail.includes('fallbackLabel: "审查"') &&
      rightRail.includes('fallbackLabel: "文件"'),
    "right rail top strip labels browser/review/files like Codex",
  );
  assert.ok(
    rightRail.includes("CodexEnvironmentPopover") &&
      rightRail.includes("environmentOpen"),
    "environment info is a popover instead of a permanent panel",
  );
  assert.ok(
    rightRail.includes("GitHub CLI 不可用") &&
      rightRail.includes("提交或推送") &&
      rightRail.includes("branchLabel(summary.git)"),
    "environment popover mirrors Codex environment rows",
  );
  assert.ok(
    rightRail.includes("OFFSCREEN_BROWSER_CLASS") &&
      rightRail.includes("showTabStrip={false}"),
    "browser webview stays mounted and delegates the browser tab to the rail strip",
  );
  assert.ok(
    !rightRail.includes("AgentRightRailEnvironmentPanel"),
    "old permanent environment section was removed",
  );
  assert.ok(
    !rightRail.includes("RightRailTabSurface") &&
      !rightRail.includes('title="浏览器"') &&
      !rightRail.includes('title="文件"'),
    "per-tab title wrapper surfaces were removed",
  );

  assert.ok(
    browserPanel.includes("showTabStrip = true") &&
      browserPanel.includes("showTabStrip &&"),
    "browser can hide its internal tab strip when embedded in the Codex rail",
  );
  assert.ok(
    browserPanel.includes("BrowserEmptyState") &&
      browserPanel.includes("开始浏览") &&
      browserPanel.includes("输入 URL 以打开页面"),
    "browser empty state matches Codex right rail",
  );

  assert.ok(
    reviewPanel.includes("ReviewRailToolbar") &&
      reviewPanel.includes('review.source === "git"') &&
      reviewPanel.includes('review.source === "direct"') &&
      reviewPanel.includes('"已编辑"') &&
      reviewPanel.includes('"待审查"'),
    "embedded review uses a Codex-like review toolbar",
  );
  assert.ok(
    reviewPanel.includes("embedded ? (") &&
      reviewPanel.includes("<ReviewRailToolbar"),
    "embedded review no longer renders the old title header",
  );

  assert.ok(
    terminalPanel.includes("showHeader?: boolean") &&
      terminalPanel.includes("showHeader = true") &&
      terminalPanel.includes("{showHeader ?"),
    "terminal header can be hidden in the rail",
  );
  assert.ok(
    agentPanel.includes("showHeader={false}") &&
      agentPanel.includes("contextSummary={rightRailContextSummary}") &&
      agentPanel.includes('useState<AgentRightRailTab>("launcher")'),
    "triple layout starts in launcher, passes rail context, and hides the terminal header",
  );

  console.log("validate-codex-right-rail: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

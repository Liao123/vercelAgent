/**
 * A105：离线断言三栏壳与 Cursor 对齐（无实验开关、右栏 Tab、中栏应用更改）。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const panel = await read("src/components/agent-panel.tsx");
  const sidebar = await read("src/components/agent-session-sidebar.tsx");
  const rightRail = await read("src/components/agent-right-rail.tsx");
  const changeCard = await read("src/components/agent-turn-change-card.tsx");
  const reviewPanel = await read("src/components/agent-review-panel.tsx");
  const tree = await read("src/components/workspace-file-tree.tsx");
  const composer = await read("src/components/agent-composer.tsx");
  const agentSettings = await read("src/components/agent-agent-settings.tsx");

  assert.ok(!panel.includes("AgentSettingsPanel"), "agent settings panel removed");
  assert.ok(panel.includes("AgentRightRail"), "triple layout uses right rail tabs");
  assert.ok(!sidebar.includes("hiddenWorkspaceIds"), "no hidden project list");
  assert.ok(!sidebar.includes("removeProject"), "no remove project action");
  assert.ok(rightRail.includes('label: "审查"'), "review tab present");
  assert.ok(rightRail.includes("aria-label={item.label}"), "icon tabs keep aria labels");
  assert.ok(rightRail.includes("h-7 w-7"), "icon-only tab buttons");
  assert.ok(
    tree.includes("buildGitStatusPathMap"),
    "file tree loads git status highlights",
  );
  assert.ok(tree.includes("highlightPath"), "file tree supports review highlight");
  assert.ok(panel.includes("treeHighlightPath"), "panel wires review to tree");
  assert.ok(panel.includes("handleTreeSelectPath"), "tree click syncs review");
  assert.ok(panel.includes("openReviewForPath"), "tree opens review for changed files");
  assert.ok(reviewPanel.includes("onRevealInTree"), "review double-click reveals in tree");

  const workspace = await read("src/components/agent-workspace.tsx");
  assert.ok(workspace.includes("devMode &&"), "develop closed loop off main path");
  assert.ok(
    sidebar.includes("threadContextMenu"),
    "session delete via context menu not hover",
  );
  assert.ok(!sidebar.includes("group-hover/thread"), "no hover action chips on threads");
  assert.ok(
    sidebar.includes("AgentWorkspaceBridge.useAgentWorkspaceBridge"),
    "sidebar uses correct workspace bridge hook",
  );
  assert.ok(
    sidebar.includes("AgentWorkspaceBridge.useAgentWorkspaceBridge"),
    "sidebar imports bridge module namespace",
  );
  assert.ok(rightRail.includes('label: "文件"'), "files tab present");
  assert.ok(rightRail.includes('label: "浏览器"'), "browser tab present");
  assert.ok(changeCard.includes("应用更改"), "turn card apply button");
  assert.ok(
    changeCard.includes("showInlineActions"),
    "turn card can hide inline accept in triple",
  );
  assert.ok(
    reviewPanel.includes("REVIEW_ACTION_APPLY") &&
      reviewPanel.includes("ReviewFileNav"),
    "review panel cursor labels + file nav",
  );
  assert.ok(
    !reviewPanel.includes("onApproveAndExecute"),
    "review panel has no legacy approval hook name",
  );
  assert.ok(
    panel.includes("onFixLintAfterWrite"),
    "triple chat shows post-write verification fix hook",
  );
  assert.ok(
    changeCard.includes("PostExecuteVerificationView"),
    "turn change card shows verify result",
  );
  assert.ok(composer.includes("parseActiveAtQuery"), "composer @ mention wired");
  assert.ok(
    composer.includes("AgentAgentSettings"),
    "agent prefs in composer not sidebar",
  );
  assert.ok(
    agentSettings.includes("readAutoApplyFileChanges"),
    "auto-apply pref wired",
  );
  assert.ok(
    reviewPanel.includes("FileListRow"),
    "review file list uses vertical rows in triple layout",
  );
  assert.ok(
    reviewPanel.includes("选择左侧文件查看 diff") ||
      !reviewPanel.includes("点击上方文件查看 diff"),
    "review auto-selects first file in embedded mode",
  );
  assert.ok(
    changeCard.includes("onReview") || changeCard.includes("onReviewApproval"),
    "turn card wires review callback",
  );
  assert.ok(
    !changeCard.includes("isPending && approvalId && onReview"),
    "turn card file rows open review after apply",
  );
  assert.ok(
    panel.includes("打开文件夹") || panel.includes("pickWorkspaceFolder"),
    "desktop open folder in workspace picker",
  );
  assert.ok(sidebar.includes("新建 Agent"), "sidebar new agent button");
  assert.ok(sidebar.includes("onNewSessionInProject"), "per-project new session");
  assert.ok(panel.includes("AgentNewChatHero"), "new chat hero");
  assert.ok(panel.includes("workspacePicker"), "panel wires workspace picker");
  assert.ok(composer.includes("AgentWorkspacePicker"), "picker in composer");

  console.log("validate-cursor-shell-ui: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const reviewPanel = await read("src/components/agent-review-panel.tsx");
  const changeCard = await read("src/components/agent-turn-change-card.tsx");
  const panel = await read("src/components/agent-panel.tsx");
  const emptyHint = await read("src/lib/review-empty-hint.ts");
  const rightRail = await read("src/components/agent-right-rail.tsx");

  assert.ok(
    emptyHint.includes("REVIEW_ACTION_APPLY") &&
      emptyHint.includes("应用更改"),
    "review action labels",
  );
  assert.ok(
    reviewPanel.includes("代码审查") && reviewPanel.includes("FileListRow"),
    "review panel header + list rows",
  );
  assert.ok(
    reviewPanel.includes("defaultAcceptMode") &&
      reviewPanel.includes("撤销更改"),
    "default accept + revert on hover",
  );
  assert.ok(
    panel.includes("revert-file") && panel.includes("defaultAcceptMode"),
    "triple review revert wiring",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "src/lib/workspace-revert-file.ts"))
      .then(() => true)
      .catch(() => false),
    "workspace revert helper",
  );
  assert.ok(
    reviewPanel.includes("buildReviewEmptyHint"),
    "contextual empty hints",
  );
  assert.ok(
    changeCard.includes("TURN_CHANGE_APPLY") ||
      changeCard.includes("应用更改"),
    "turn change card labels",
  );
  assert.ok(
    changeCard.includes("在审查中查看"),
    "turn card review shortcut",
  );
  assert.ok(
    panel.includes("setRightRailTab(\"review\")"),
    "auto focus review tab",
  );
  assert.ok(
    rightRail.includes("pendingReviewCount") && rightRail.includes("showBadge"),
    "review tab badge",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "scripts/cursor-review-notes.template.json"))
      .then(() => true)
      .catch(() => false),
    "cursor review notes template",
  );

  console.log("validate-cursor-review-ui: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

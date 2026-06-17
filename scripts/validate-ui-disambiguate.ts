import { disambiguateUiLabels } from "../src/agent/indexer";
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const rootPath = process.cwd();

  const result = await disambiguateUiLabels({
    rootPath,
    query: GOLDEN_UI_QUERY,
    uiContext: GOLDEN_UI_CONTEXT,
    traceSuggestedOrder: [SIDEBAR_PATH, PANEL_PATH],
  });

  assert(result.hasAmbiguity, "sidebar plus query should produce ambiguity");
  assert(
    result.recommendedPath === SIDEBAR_PATH,
    `recommended should be sidebar, got ${result.recommendedPath}`,
  );
  assert(
    result.mustReadPaths.includes(SIDEBAR_PATH) &&
      result.mustReadPaths.includes(PANEL_PATH),
    `mustReadPaths should include sidebar and panel: ${result.mustReadPaths.join(", ")}`,
  );
  assert(
    Boolean(result.selectionRationale?.includes(SIDEBAR_PATH)),
    "selection rationale should mention recommended file",
  );

  const primaryGroup = result.groups.find(
    (g) => g.label === GOLDEN_DISAMBIGUATION_LABEL,
  );
  assert(primaryGroup, "should have 新建 Agent disambiguation group");
  assert(
    primaryGroup!.candidates[0]!.filePath === SIDEBAR_PATH,
    "新建 Agent group top candidate should be sidebar",
  );
  assert(
    primaryGroup!.candidates.some((c) => c.filePath === PANEL_PATH),
    "新建 Agent group should include agent-panel as alternate",
  );

  console.log("validate-ui-disambiguate: passed", {
    recommendedPath: result.recommendedPath,
    mustReadPaths: result.mustReadPaths,
    topScores: primaryGroup!.candidates.slice(0, 2).map((c) => ({
      path: c.filePath,
      score: c.score,
    })),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { disambiguateUiLabels } from "../src/agent/indexer";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const query = "把首页左边的闭环选择去掉";
  const uiContext = { layout: "triple" as const, activeRoute: "/" };
  const composerPath = "src/components/agent-composer.tsx";
  const panelPath = "src/components/agent-panel.tsx";

  const result = await disambiguateUiLabels({
    rootPath,
    query,
    uiContext,
    traceSuggestedOrder: [
      composerPath,
      "src/components/agent-run-mode-hint.tsx",
      panelPath,
    ],
  });

  assert(result.hasAmbiguity, "Loop/闭环 query should produce ambiguity");
  assert(
    result.recommendedPath === composerPath,
    `recommended should be composer, got ${result.recommendedPath}`,
  );
  assert(
    result.mustReadPaths.includes(composerPath) &&
      result.mustReadPaths.includes(panelPath),
    `mustReadPaths should include composer and panel: ${result.mustReadPaths.join(", ")}`,
  );
  assert(
    Boolean(result.selectionRationale?.includes(composerPath)),
    "selection rationale should mention recommended file",
  );

  const primaryGroup = result.groups.find((g) => g.label === "闭环");
  assert(primaryGroup, "should have 闭环 disambiguation group");
  assert(
    primaryGroup!.candidates[0]!.filePath === composerPath,
    "闭环 group top candidate should be composer",
  );
  assert(
    primaryGroup!.candidates.some((c) => c.filePath === panelPath),
    "闭环 group should include agent-panel as alternate",
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

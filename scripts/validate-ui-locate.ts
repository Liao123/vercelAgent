import { traceUiEntryForQuery } from "../src/agent/indexer";

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

  const trace = await traceUiEntryForQuery(rootPath, query, uiContext);
  assert(Boolean(trace), "UI query should trigger import tree trace");
  assert(
    trace!.suggestedReadOrder[0] === composerPath,
    `triple layout should rank composer first, got ${trace!.suggestedReadOrder[0]}`,
  );
  assert(
    !trace!.suggestedReadOrder.slice(0, 3).includes(panelPath),
    "agent-panel should not appear in top 3 for triple RunMode query",
  );

  const composerNode = trace!.nodes.find((n) => n.filePath === composerPath);
  assert(composerNode, "trace should reach agent-composer.tsx");
  assert(
    composerNode!.visibleLabels.some((label) => /闭环|loop/i.test(label)),
    "composer should expose Loop/闭环 visible labels in trace",
  );

  console.log("validate-ui-locate: golden path passed", {
    traceFirst: trace!.suggestedReadOrder[0],
    composerLabels: composerNode!.visibleLabels.slice(0, 4),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

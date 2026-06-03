import { traceUiEntryForQuery } from "../src/agent/indexer";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const query = "修改首页界面输入框 placeholder，强调 @ 附加文件";
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
    "agent-panel should not appear in top 3 for composer @ query",
  );

  const composerNode = trace!.nodes.find((n) => n.filePath === composerPath);
  assert(composerNode, "trace should reach agent-composer.tsx");
  assert(
    composerNode!.visibleLabels.some((label) =>
      /附加|placeholder|描述要做的改动/i.test(label),
    ),
    "composer should expose placeholder / attach labels in trace",
  );

  console.log("validate-ui-locate: golden path passed", {
    traceFirst: trace!.suggestedReadOrder[0],
    composerLabels: composerNode!.visibleLabels.slice(0, 6),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import assert from "node:assert/strict";
import {
  buildProjectIndex,
  findJsxText,
  findSymbolReferences,
} from "../src/agent/indexer";

async function main(): Promise<void> {
  const rootPath = process.cwd();
  const uiContext = { layout: "triple" as const, activeRoute: "/" };
  const composerPath = "src/components/agent-composer.tsx";

  const jsx = await findJsxText({
    rootPath,
    query: "闭环",
    maxResults: 12,
    uiContext,
  });

  assert.ok(jsx.matches.length > 0, "jsx.find_text should find 闭环");
  const top = jsx.matches[0]!;
  assert.equal(
    top.filePath,
    composerPath,
    `top jsx match should be composer, got ${top.filePath}`,
  );
  assert.ok(top.line > 0, "match should have line number");
  assert.ok(top.componentName, "should infer component name");

  const index = await buildProjectIndex(rootPath);
  const refs = await findSymbolReferences({
    rootPath,
    index,
    path: composerPath,
    maxResults: 20,
  });

  assert.ok(
    refs.references.some((ref) => ref.filePath.includes("agent-panel")),
    "agent-composer should be imported by agent-panel",
  );

  const agentComposerDef = await findSymbolReferences({
    rootPath,
    index,
    name: "AgentComposer",
    maxResults: 20,
  });

  assert.ok(
    agentComposerDef.definitions.some((d) => d.filePath === composerPath),
    "AgentComposer should be defined in composer file",
  );

  console.log("validate-jsx-reference: passed", {
    jsxTop: `${top.filePath}:${top.line}`,
    componentName: top.componentName,
    importRefs: refs.references.slice(0, 3).map((r) => r.filePath),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

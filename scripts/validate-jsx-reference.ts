import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { findJsxText, findSymbolReferences } from "../src/agent/indexer";
import { buildProjectIndex } from "../src/agent/indexer/project-indexer";
import {
  GOLDEN_UI_CONTEXT,
  PANEL_PATH,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

async function main(): Promise<void> {
  const rootPath = process.cwd();

  const jsx = await findJsxText({
    rootPath,
    query: "加号",
    maxResults: 12,
    uiContext: GOLDEN_UI_CONTEXT,
  });

  assert.ok(jsx.matches.length > 0, "jsx.find_text should find plus control");
  const top = jsx.matches[0]!;
  assert.equal(
    top.filePath,
    SIDEBAR_PATH,
    `top jsx match should be sidebar, got ${top.filePath}`,
  );
  assert.ok(top.line > 0, "match should have line number");
  assert.ok(top.componentName, "should infer component name");

  const panelSource = await fs.readFile(PANEL_PATH, "utf8");
  assert.ok(
    panelSource.includes('from "@/components/agent-session-sidebar"'),
    "agent-panel should import agent-session-sidebar",
  );
  assert.ok(
    panelSource.includes("AgentSessionSidebar"),
    "agent-panel should render AgentSessionSidebar",
  );

  const index = await buildProjectIndex(rootPath);
  const sidebarDef = await findSymbolReferences({
    rootPath,
    index,
    name: "AgentSessionSidebar",
    maxResults: 20,
  });

  assert.ok(
    sidebarDef.definitions.some((d) => d.filePath === SIDEBAR_PATH),
    "AgentSessionSidebar should be defined in sidebar file",
  );

  console.log("validate-jsx-reference: passed", {
    jsxTop: `${top.filePath}:${top.line}`,
    componentName: top.componentName,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

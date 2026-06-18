/**
 * 黄金路径全链路准确度回归（无需 LLM / dev server）。
 *
 * 用例：triple 布局下「去掉侧栏项目行 ＋ 新建会话按钮」（handoff P0）
 *
 * 运行：npm run validate:golden-path
 */
import fs from "node:fs/promises";
import { buildPrepareEvidenceFromSearch } from "../src/agent/approval/prepare-evidence";
import {
  mergeAttachedPaths,
  parseAtPathsFromRequest,
  preloadAttachedFiles,
} from "../src/agent/core/attached-files";
import {
  createAgentLoopRunState,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import { assertPrepareGate } from "../src/agent/core/prepare-gate";
import {
  disambiguateUiLabels,
  findJsxText,
  traceUiEntryForQuery,
} from "../src/agent/indexer";
import { resolveInsideWorkspace } from "../src/agent/tools/path-safety";
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_CONTEXT,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
  SIDEBAR_PLUS_LINE,
} from "./golden-path-fixtures";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectGateError(fn: () => void): string {
  try {
    fn();
    throw new Error("expected prepare gate to throw");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main(): Promise<void> {
  const rootPath = process.cwd();

  const trace = await traceUiEntryForQuery(
    rootPath,
    GOLDEN_UI_QUERY,
    GOLDEN_UI_CONTEXT,
  );
  assert(Boolean(trace), "trace should run for sidebar UI query");

  const disambiguation = await disambiguateUiLabels({
    rootPath,
    query: GOLDEN_UI_QUERY,
    uiContext: GOLDEN_UI_CONTEXT,
    traceSuggestedOrder: [SIDEBAR_PATH, PANEL_PATH],
  });
  assert(
    disambiguation.hasAmbiguity,
    "sidebar plus query should disambiguate 新建 Agent",
  );
  assert(
    disambiguation.recommendedPath === SIDEBAR_PATH,
    "disambiguation recommends sidebar",
  );
  assert(
    disambiguation.mustReadPaths.includes(SIDEBAR_PATH) &&
      disambiguation.mustReadPaths.includes(PANEL_PATH),
    "mustReadPaths should include sidebar and panel",
  );

  const jsx = await findJsxText({
    rootPath,
    query: "加号",
    maxResults: 12,
    uiContext: GOLDEN_UI_CONTEXT,
  });
  assert(jsx.matches.length > 0, "jsx.find_text should find plus control");
  const topJsx = jsx.matches[0]!;
  assert(
    topJsx.filePath === SIDEBAR_PATH,
    `jsx top hit should be sidebar, got ${topJsx.filePath}`,
  );
  assert(topJsx.line > 0, "jsx match should have line number");

  const atParsed = parseAtPathsFromRequest(
    `请修改 @${SIDEBAR_PATH} 去掉项目行加号`,
  );
  assert(
    atParsed.attachedPaths.includes(SIDEBAR_PATH),
    "@path parser should extract sidebar",
  );
  const attachedPaths = mergeAttachedPaths([], atParsed.attachedPaths);
  const preloaded = await preloadAttachedFiles({ rootPath, paths: attachedPaths });
  assert(preloaded.length === 1 && preloaded[0]!.content, "attached preload should succeed");

  const attachOnlyState = createAgentLoopRunState(atParsed.cleanRequest);
  for (const file of preloaded) {
    if (file.content) {
      recordToolCall(attachOnlyState, "file.read", {
        path: file.path,
        content: file.content,
      });
    }
  }
  const attachOnlyError = expectGateError(() =>
    assertPrepareGate({
      toolName: "file.replace.prepare",
      requiredReadPaths: [SIDEBAR_PATH],
      runState: attachOnlyState,
      enforce: true,
    }),
  );
  assert(
    attachOnlyError.includes("ui.trace_from_page") ||
      attachOnlyError.includes("file.locate"),
    `attach-only should still require UI locate: ${attachOnlyError}`,
  );

  const happyState = createAgentLoopRunState(GOLDEN_UI_QUERY);
  happyState.toolsCalled.push("file.locate");
  happyState.disambiguation = {
    label: GOLDEN_DISAMBIGUATION_LABEL,
    mustReadPaths: disambiguation.mustReadPaths,
    recommendedPath: disambiguation.recommendedPath,
    selectionRationale: disambiguation.selectionRationale ?? "",
  };
  for (const filePath of disambiguation.mustReadPaths) {
    happyState.filesRead.push(filePath);
  }
  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: [SIDEBAR_PATH],
    runState: happyState,
    enforce: true,
  });

  const sidebarContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, SIDEBAR_PATH),
    "utf8",
  );
  assert(
    sidebarContent.includes(SIDEBAR_PLUS_LINE),
    "sidebar should contain exact plus JSX text on disk",
  );
  const evidence = buildPrepareEvidenceFromSearch({
    path: SIDEBAR_PATH,
    content: sidebarContent,
    search: SIDEBAR_PLUS_LINE,
    source: "file.replace.prepare",
  });
  assert(evidence.path === SIDEBAR_PATH, "evidence path should be sidebar");
  assert(
    evidence.startLine >= 450 && evidence.startLine <= 470,
    `evidence line should be near plus button, got ${evidence.startLine}`,
  );
  assert(
    evidence.matchedSnippet.includes("+"),
    "evidence snippet should include plus sign",
  );

  console.log("validate-golden-path: passed", {
    traceFirst: trace!.suggestedReadOrder[0],
    recommendedPath: disambiguation.recommendedPath,
    jsxTop: { path: topJsx.filePath, line: topJsx.line },
    evidenceLine: evidence.startLine,
    attachedPaths,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

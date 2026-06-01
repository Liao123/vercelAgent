/**
 * 黄金路径全链路准确度回归（无需 LLM / dev server）。
 *
 * 用例：triple 布局下「去掉首页左边闭环/Loop 选择」
 * 串联 A072–A080 的定位、消歧、门禁、JSX 引用、@ 附加与证据链。
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

const GOLDEN_QUERY = "把首页左边的闭环/Loop 选择去掉";
const UI_CONTEXT = { layout: "triple" as const, activeRoute: "/" };
const COMPOSER = "src/components/agent-composer.tsx";
const PANEL = "src/components/agent-panel.tsx";

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

  const trace = await traceUiEntryForQuery(rootPath, GOLDEN_QUERY, UI_CONTEXT);
  assert(Boolean(trace), "trace should run for homepage UI query");
  assert(
    trace!.suggestedReadOrder[0] === COMPOSER,
    `trace first read should be composer, got ${trace!.suggestedReadOrder[0]}`,
  );

  const disambiguation = await disambiguateUiLabels({
    rootPath,
    query: GOLDEN_QUERY,
    uiContext: UI_CONTEXT,
    traceSuggestedOrder: trace!.suggestedReadOrder,
  });
  assert(disambiguation.recommendedPath === COMPOSER, "disambiguation recommends composer");
  assert(
    disambiguation.mustReadPaths.includes(COMPOSER) &&
      disambiguation.mustReadPaths.includes(PANEL),
    "mustReadPaths should include composer and panel",
  );

  const jsx = await findJsxText({
    rootPath,
    query: "闭环",
    maxResults: 12,
    uiContext: UI_CONTEXT,
  });
  assert(jsx.matches.length > 0, "jsx.find_text should find 闭环");
  const topJsx = jsx.matches[0]!;
  assert(
    topJsx.filePath === COMPOSER,
    `jsx top hit should be composer, got ${topJsx.filePath}`,
  );
  assert(topJsx.line > 0, "jsx match should have line number");

  const atParsed = parseAtPathsFromRequest(
    `请修改 @${COMPOSER} 去掉 Loop/闭环切换`,
  );
  assert(
    atParsed.attachedPaths.includes(COMPOSER),
    "@path parser should extract composer",
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
      requiredReadPaths: [COMPOSER],
      runState: attachOnlyState,
    }),
  );
  assert(
    attachOnlyError.includes("ui.trace_from_page") ||
      attachOnlyError.includes("file.locate"),
    `attach-only should still require UI locate: ${attachOnlyError}`,
  );

  const happyState = createAgentLoopRunState(GOLDEN_QUERY);
  happyState.toolsCalled.push("ui.trace_from_page");
  happyState.disambiguation = {
    label: "闭环",
    mustReadPaths: disambiguation.mustReadPaths,
    recommendedPath: disambiguation.recommendedPath,
    selectionRationale: disambiguation.selectionRationale ?? "",
  };
  for (const filePath of disambiguation.mustReadPaths) {
    happyState.filesRead.push(filePath);
  }
  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: [COMPOSER],
    runState: happyState,
  });

  const composerContent = await fs.readFile(
    resolveInsideWorkspace(rootPath, COMPOSER),
    "utf8",
  );
  const exactSearch = "                    闭环";
  assert(
    composerContent.includes(exactSearch),
    "composer should contain exact 闭环 JSX text on disk",
  );
  const evidence = buildPrepareEvidenceFromSearch({
    path: COMPOSER,
    content: composerContent,
    search: exactSearch,
    source: "file.replace.prepare",
  });
  assert(evidence.path === COMPOSER, "evidence path should be composer");
  assert(
    evidence.startLine >= 190 && evidence.startLine <= 210,
    `evidence line should be near RunMode UI, got ${evidence.startLine}`,
  );
  assert(
    evidence.matchedSnippet.includes("闭环"),
    "evidence snippet should include matched label",
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

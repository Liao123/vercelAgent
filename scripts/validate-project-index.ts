/**
 * A158 project index 缓存 + scoped query + gate 行为。
 *
 * 运行：npm run validate:project-index
 */
import assert from "node:assert/strict";
import {
  getOrBuildProjectIndex,
  invalidateProjectIndexCache,
  peekProjectIndexCache,
} from "../src/agent/indexer/project-index-cache";
import { searchProjectIndex } from "../src/agent/indexer/project-index-search";
import {
  evaluateToolEvidenceGate,
  isExplorationGatherIntent,
} from "../src/agent/core/evidence-gate";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";

async function main(): Promise<void> {
  const rootPath = process.cwd();
  invalidateProjectIndexCache();

  const first = await getOrBuildProjectIndex(rootPath);
  const cached = peekProjectIndexCache(rootPath);
  assert.ok(cached, "cache should hold index after first build");
  assert.equal(cached!.generatedAt, first.generatedAt);

  const second = await getOrBuildProjectIndex(rootPath);
  assert.equal(second.generatedAt, first.generatedAt, "cache hit should reuse index");

  const scoped = searchProjectIndex(first, "agent loop", 8);
  assert.ok(scoped.candidateCount >= 1, "scoped search should return candidates");
  assert.ok(
    scoped.candidates.some((c) => c.filePath.includes("agent")),
    "agent-related path expected in scoped hits",
  );

  const apiScoped = searchProjectIndex(first, "api", 10);
  assert.ok(
    apiScoped.matchingApiRoutes.length >= 1 || apiScoped.candidates.length >= 1,
    "api query should hit routes or files",
  );

  const narrowReasoning = {
    understanding: "问工作区网站标题",
    intent: "qa" as const,
    risk: "read_only" as const,
    evidenceNeeded: ["layout metadata"],
    planSteps: ["read layout"],
    ambiguity: "page title vs package name",
    canAnswerNow: false,
    plannedNext: "file.read",
    source: "model" as const,
  };

  const indexState = createAgentLoopRunState("标题");
  indexState.taskReasoning = narrowReasoning;
  indexState.toolsCalled.push("project.index");

  const repeatFull = evaluateToolEvidenceGate("project.index", {}, indexState);
  assert.equal(repeatFull.allowed, false, "repeat full index blocked");

  const repeatScoped = evaluateToolEvidenceGate(
    "project.index",
    { query: "layout metadata" },
    indexState,
  );
  assert.equal(repeatScoped.allowed, true, "scoped index allowed after full");

  const exploreState = createAgentLoopRunState("列出 API 路由");
  exploreState.taskReasoning = {
    understanding: "枚举 API",
    intent: "analysis" as const,
    risk: "read_only" as const,
    evidenceNeeded: ["api routes"],
    planSteps: ["project.index overview"],
    ambiguity: null,
    canAnswerNow: false,
    plannedNext: "project.index",
    source: "model" as const,
  };
  assert.ok(isExplorationGatherIntent(exploreState));

  const toolsSource = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/agent/core/agent-loop-tools.ts", "utf8"),
  );
  assert.ok(
    toolsSource.includes("getOrBuildProjectIndex"),
    "tools use session cache",
  );
  assert.ok(toolsSource.includes("searchProjectIndex"), "tools support scoped index");

  console.log("validate-project-index: passed", {
    fileCount: first.files.length,
    scopedCandidates: scoped.candidateCount,
    cacheHit: second.generatedAt === first.generatedAt,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

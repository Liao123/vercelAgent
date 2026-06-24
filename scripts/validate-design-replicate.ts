/**
 * A024：design spec 持久化 + design-replicate 任务剧本静态验收。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadLatestDesignSpec,
  loadLatestDesignSpecMeta,
  saveDesignSpec,
} from "../src/agent/browser/design-spec-store.ts";
import {
  summarizeDesignSpec,
  type DesignSpec,
} from "../src/agent/devtools/extract-design-spec.ts";
import {
  computePlaybookProgress,
  isDesignReplicateRequest,
  isBrowserDocAnalysisRequest,
  resolveTaskPlaybook,
} from "../src/agent/core/task-playbooks.ts";
import {
  buildReplicateAfterExtractNudge,
  buildReplicateAfterWriteNudge,
  buildReplicateEmptyWorkspaceNudge,
  applyWorkspaceStructureToRunState,
  isDesignReplicateTask,
} from "../src/agent/core/loop-replicate-nudge.ts";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state.ts";
import {
  DEMO_REPLICATE_PAGE_PATH,
  GOLDEN_DESIGN_REPLICATE_QUERY,
} from "./golden-path-fixtures.ts";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

function sampleSpec(): DesignSpec {
  return {
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 1280, height: 720 },
    theme: {
      bodyColor: "rgb(0, 0, 0)",
      bodyBackground: "rgb(255, 255, 255)",
      fontFamily: "system-ui",
    },
    nodes: [
      {
        tag: "h1",
        text: "Example Domain",
        bounds: { x: 0, y: 80, w: 400, h: 48 },
        styles: {
          color: "rgb(0, 0, 0)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          fontSize: "32px",
          fontFamily: "system-ui",
          fontWeight: "700",
          borderRadius: "0px",
          padding: "0px",
          display: "block",
        },
      },
      {
        tag: "p",
        text: "This domain is for use in documentation examples",
        bounds: { x: 0, y: 140, w: 500, h: 24 },
        styles: {
          color: "rgb(51, 51, 51)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          fontSize: "16px",
          fontFamily: "system-ui",
          fontWeight: "400",
          borderRadius: "0px",
          padding: "0px",
          display: "block",
        },
      },
    ],
    extractedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const tools = await read("src/agent/core/agent-loop-tools.ts");
  assert.ok(tools.includes("saveDesignSpec"), "extract persists design spec");
  assert.ok(
    tools.includes("devtools.get_persisted_design_spec"),
    "get_persisted_design_spec tool",
  );
  assert.ok(tools.includes("summarizeDesignSpec"), "extract returns summary");

  const playbooks = await read("src/agent/core/task-playbooks.ts");
  assert.ok(playbooks.includes("design-replicate"), "design-replicate playbook");
  assert.ok(playbooks.includes("isDesignReplicateRequest"), "matcher");

  assert.ok(
    await fs
      .access(path.join(ROOT, DEMO_REPLICATE_PAGE_PATH))
      .then(() => true)
      .catch(() => false),
    "demo-replicate placeholder page",
  );

  assert.ok(
    isDesignReplicateRequest(GOLDEN_DESIGN_REPLICATE_QUERY),
    "golden design replicate detect",
  );
  assert.ok(
    !isDesignReplicateRequest(
      "帮我解析 https://s.apifox.cn/foo 的接口参数",
    ),
    "doc parse not design replicate",
  );
  assert.ok(
    !isBrowserDocAnalysisRequest(GOLDEN_DESIGN_REPLICATE_QUERY),
    "not browser-doc",
  );

  const replicateState = {
    userRequest: GOLDEN_DESIGN_REPLICATE_QUERY,
    taskReasoning: {
      understanding: "复刻首页",
      intent: "code_edit" as const,
      risk: "write" as const,
      evidenceNeeded: [],
      planSteps: [],
      ambiguity: null,
      canAnswerNow: false,
      plannedNext: "extract",
      source: "model" as const,
    },
  };
  const pb = resolveTaskPlaybook(
    GOLDEN_DESIGN_REPLICATE_QUERY,
    replicateState as import("../src/agent/core/agent-loop-state").AgentLoopRunState,
  );
  assert.equal(pb.id, "design-replicate");

  const progress = computePlaybookProgress(
    pb,
    ["devtools.extract_design_spec", "file.read", "file.replace"],
    ["src/app/demo-replicate/page.tsx"],
  );
  assert.equal(progress.completedCount, 3);
  assert.ok(progress.progressLabel.includes("复刻"));

  const spec = sampleSpec();
  const summary = summarizeDesignSpec(spec);
  assert.equal(summary.nodeCount, 2);
  assert.ok(summary.topNodes.length > 0);
  assert.ok(summary.colorPalette.length > 0);

  const meta = await saveDesignSpec(spec);
  assert.ok(meta.filePath.includes("design-specs"));
  const loaded = await loadLatestDesignSpec();
  assert.equal(loaded?.title, "Example");
  const loadedMeta = await loadLatestDesignSpecMeta();
  assert.equal(loadedMeta?.id, meta.id);

  const state = createAgentLoopRunState(GOLDEN_DESIGN_REPLICATE_QUERY);
  state.playbookId = "design-replicate";
  state.toolsCalled.push("devtools.extract_design_spec");
  assert.ok(isDesignReplicateTask(state));
  const extractNudge = buildReplicateAfterExtractNudge(state);
  assert.ok(extractNudge?.includes("get_persisted_design_spec"));
  assert.ok(extractNudge?.includes("file.mutation"));

  state.filesWritten = ["index.html", "src/styles.css", "src/main.js"];
  state.editApplied = true;
  const writeOk = buildReplicateAfterWriteNudge(state, state.filesWritten);
  assert.ok(writeOk?.includes("deliverable OK"));

  state.filesWritten = ["index.html"];
  const writeBare = buildReplicateAfterWriteNudge(state, ["index.html"]);
  assert.ok(writeBare?.includes("incomplete"));

  const emptyState = createAgentLoopRunState(
    "复刻 http://example.com 写到当前项目",
  );
  emptyState.playbookId = "design-replicate";
  applyWorkspaceStructureToRunState(emptyState, {
    rootPath: "/tmp/empty",
    staleConfiguredPath: null,
    hasPackageJson: false,
    hasSrcApp: false,
    hasAppDir: false,
    hasPagesDir: false,
    topLevelEntryCount: 0,
    topLevelEntries: [],
    observations: ["workspace root appears empty"],
  });
  const emptyNudge = buildReplicateEmptyWorkspaceNudge(emptyState);
  assert.ok(emptyNudge?.includes("index.html"));
  assert.ok(emptyNudge?.includes("get_persisted_design_spec"));

  const verifyState = createAgentLoopRunState(GOLDEN_DESIGN_REPLICATE_QUERY);
  verifyState.playbookId = "design-replicate";
  verifyState.filesWritten = ["index.html", "src/styles.css", "src/main.js"];
  verifyState.editApplied = true;
  const verifyNudge = buildReplicateAfterWriteNudge(
    verifyState,
    verifyState.filesWritten,
    process.cwd(),
  );
  assert.ok(verifyNudge?.includes("deliverable OK"));

  console.log("validate-design-replicate: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

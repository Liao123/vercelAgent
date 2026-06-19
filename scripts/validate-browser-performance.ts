/**
 * A134/A135：performance trace + extract_design_spec + analyze_insight 静态验收。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  analyzeTraceInsight,
  listAvailableInsights,
} from "../src/agent/devtools/performance-trace-analyze.ts";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

const A134_TOOLS = [
  "devtools.performance_start_trace",
  "devtools.performance_stop_trace",
  "devtools.performance_analyze_insight",
  "devtools.extract_design_spec",
];

async function main(): Promise<void> {
  const cdpMain = await read("electron/browser-cdp.mjs");
  assert.ok(cdpMain.includes("startPerformanceTrace"), "startPerformanceTrace");
  assert.ok(cdpMain.includes("stopPerformanceTrace"), "stopPerformanceTrace");
  assert.ok(cdpMain.includes("/performance/start"), "bridge /performance/start");
  assert.ok(cdpMain.includes("/performance/stop"), "bridge /performance/stop");
  assert.ok(cdpMain.includes("Tracing.start"), "CDP Tracing.start");
  assert.ok(cdpMain.includes("Tracing.end"), "CDP Tracing.end");
  assert.ok(cdpMain.includes("Tracing.dataCollected"), "trace dataCollected");

  const client = await read("src/agent/devtools/cdp-client.ts");
  assert.ok(client.includes("cdpPerformanceStartTrace"), "cdpPerformanceStartTrace");
  assert.ok(client.includes("cdpPerformanceStopTrace"), "cdpPerformanceStopTrace");

  assert.ok(
    await fs
      .access(path.join(ROOT, "src/agent/devtools/extract-design-spec.ts"))
      .then(() => true)
      .catch(() => false),
    "extract-design-spec.ts",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "src/agent/devtools/performance-trace-analyze.ts"))
      .then(() => true)
      .catch(() => false),
    "performance-trace-analyze.ts",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "src/agent/devtools/performance-stop-result.ts"))
      .then(() => true)
      .catch(() => false),
    "performance-stop-result.ts",
  );

  const tools = await read("src/agent/core/agent-loop-tools.ts");
  for (const name of A134_TOOLS) {
    assert.ok(tools.includes(`"${name}"`), `tool ${name}`);
  }
  assert.ok(
    tools.includes("extractDesignSpecFromPage"),
    "extract_design_spec uses extractor",
  );
  assert.ok(
    tools.includes("analyzePerformanceInsight"),
    "performance_analyze_insight handler",
  );
  assert.ok(
    tools.includes("enrichPerformanceStopResult"),
    "stop_trace enriches with availableInsights",
  );

  const synthetic = [
    { name: "navigationStart", ts: 1_000_000, ph: "I" },
    {
      name: "RunTask",
      cat: "disabled-by-default-devtools.timeline",
      ts: 1_100_000,
      dur: 80_000,
      ph: "X",
    },
    {
      name: "largestContentfulPaint::Candidate",
      ts: 1_500_000,
      ph: "I",
    },
  ];
  const available = listAvailableInsights(synthetic);
  assert.ok(available.includes("LongTasks"), "synthetic LongTasks insight");
  assert.ok(available.includes("LCPBreakdown"), "synthetic LCP insight");
  const longTasks = analyzeTraceInsight(synthetic, "LongTasks");
  assert.equal(longTasks.count, 1, "one long task");

  console.log("validate-browser-performance: passed", {
    toolCount: A134_TOOLS.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

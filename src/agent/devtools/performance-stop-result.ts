/**
 * A135：统一 enrichment performance_stop_trace 结果并持久化 last recording。
 */
import path from "node:path";
import type { PerformanceInsights } from "@/agent/devtools/performance-insights";
import { buildPerformanceInsights } from "@/agent/devtools/performance-insights";
import {
  loadPerformanceLastRecording,
  savePerformanceLastRecording,
} from "@/agent/devtools/performance-last";
import {
  analyzeTraceInsightFromFile,
  availableInsightsFromPageTiming,
  listAvailableInsightsFromFile,
  type PerformanceInsightName,
} from "@/agent/devtools/performance-trace-analyze";

type StopPayload = Record<string, unknown>;

export async function enrichPerformanceStopResult(
  stop: StopPayload,
): Promise<StopPayload> {
  const pageTiming =
    stop.pageTiming && typeof stop.pageTiming === "object"
      ? (stop.pageTiming as Record<string, unknown>)
      : null;
  const metrics = Array.isArray(stop.metrics) ? stop.metrics : [];
  const eventCount =
    typeof stop.eventCount === "number" ? stop.eventCount : 0;
  const insights: PerformanceInsights = buildPerformanceInsights(
    pageTiming,
    metrics as Array<{ name?: string; value?: number }>,
    eventCount,
  );

  let availableInsights: PerformanceInsightName[] =
    availableInsightsFromPageTiming(pageTiming);
  const traceFile =
    typeof stop.traceFile === "string" ? stop.traceFile : null;
  const traceTruncated = stop.traceTruncated === true;

  if (traceFile && !traceTruncated) {
    try {
      const fromTrace = await listAvailableInsightsFromFile(traceFile);
      availableInsights = [...new Set([...availableInsights, ...fromTrace])];
    } catch {
      /* trace 解析失败时保留 pageTiming insights */
    }
  }

  const insightSetId = traceFile
    ? path.basename(traceFile, ".json")
    : `timing-${Date.now()}`;

  const result: StopPayload = {
    ...stop,
    insights,
    insightSetId,
    availableInsights,
  };

  await savePerformanceLastRecording({
    insightSetId,
    traceFile,
    traceTruncated,
    eventCount,
    pageTiming,
    insights,
    availableInsights,
    recordedAt: new Date().toISOString(),
  });

  return result;
}

export async function analyzePerformanceInsight(args: {
  insightName: string;
  insightSetId?: string;
  traceFile?: string;
}): Promise<StopPayload> {
  const last = await loadPerformanceLastRecording();
  const traceFile = args.traceFile ?? last?.traceFile ?? null;

  if (args.insightSetId && last && last.insightSetId !== args.insightSetId) {
    return {
      ok: false,
      error: `insightSetId 不匹配。最近录制为 ${last.insightSetId}。`,
      availableInsightSets: last ? [last.insightSetId] : [],
    };
  }

  if (!traceFile) {
    return {
      ok: false,
      error:
        "无 trace 文件。请先 devtools.performance_stop_trace（且 trace 未因过大被截断）。",
      hint: last?.traceTruncated
        ? "上次 trace 过大已截断，仅可用 pageTiming 摘要。"
        : undefined,
      availableInsights: last?.availableInsights ?? [],
      insightSetId: last?.insightSetId,
    };
  }

  const detail = await analyzeTraceInsightFromFile(traceFile, args.insightName);
  return {
    ok: detail.ok !== false,
    insightSetId: last?.insightSetId ?? path.basename(traceFile, ".json"),
    detail,
    availableInsights: last?.availableInsights,
  };
}

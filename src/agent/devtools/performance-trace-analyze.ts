/**
 * A135：从 Chrome trace JSON 抽取 Performance Insights（对齐 chrome-devtools-mcp 命名）。
 */
import fs from "node:fs/promises";

export const PERFORMANCE_INSIGHT_NAMES = [
  "DocumentLatency",
  "LCPBreakdown",
  "LongTasks",
  "LayoutShifts",
  "NetworkSummary",
  "MainThreadTopTasks",
] as const;

export type PerformanceInsightName =
  typeof PERFORMANCE_INSIGHT_NAMES[number];

type TraceEvent = {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  args?: Record<string, unknown>;
};

const LONG_TASK_US = 50_000;
const MAX_LIST = 40;

function normalizeInsightName(input: string): PerformanceInsightName | null {
  const key = input.trim();
  const match = PERFORMANCE_INSIGHT_NAMES.find(
    (name) => name.toLowerCase() === key.toLowerCase(),
  );
  return match ?? null;
}

function eventName(ev: TraceEvent): string {
  return typeof ev.name === "string" ? ev.name : "";
}

function eventCat(ev: TraceEvent): string {
  return typeof ev.cat === "string" ? ev.cat : "";
}

export async function readTraceEvents(traceFile: string): Promise<TraceEvent[]> {
  const raw = await fs.readFile(traceFile, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("trace 文件格式无效：应为事件数组。");
  }
  return parsed as TraceEvent[];
}

function navigationStartTs(events: TraceEvent[]): number {
  for (const ev of events) {
    const name = eventName(ev);
    if (
      name === "navigationStart" ||
      name === "Navigation Start" ||
      name === "NavigationStart"
    ) {
      return typeof ev.ts === "number" ? ev.ts : 0;
    }
  }
  const first = events.find((ev) => typeof ev.ts === "number");
  return first?.ts ?? 0;
}

function analyzeDocumentLatency(events: TraceEvent[]) {
  const navStart = navigationStartTs(events);
  const marks: Record<string, number> = {};
  const markNames = [
    "firstContentfulPaint",
    "MarkFirstContentfulPaint",
    "firstPaint",
    "MarkDOMContent",
    "domContentLoadedEventEnd",
    "MarkLoad",
    "loadEventEnd",
  ];
  for (const ev of events) {
    const name = eventName(ev);
    if (!markNames.includes(name) || typeof ev.ts !== "number") continue;
    marks[name] = Math.round((ev.ts - navStart) / 1000);
  }
  return {
    navigationStartUs: navStart,
    marksMs: marks,
    eventHits: Object.keys(marks).length,
  };
}

function analyzeLcpBreakdown(events: TraceEvent[]) {
  const navStart = navigationStartTs(events);
  const candidates: Array<{
    name: string;
    timeMs: number;
    detail?: unknown;
  }> = [];
  for (const ev of events) {
    const name = eventName(ev);
    if (
      !name.toLowerCase().includes("largestcontentfulpaint") &&
      name !== "LCP" &&
      name !== "LargestContentfulPaint::Candidate"
    ) {
      continue;
    }
    if (typeof ev.ts !== "number") continue;
    candidates.push({
      name,
      timeMs: Math.round((ev.ts - navStart) / 1000),
      detail: ev.args,
    });
  }
  const last = candidates.at(-1);
  return {
    candidateCount: candidates.length,
    candidates: candidates.slice(-MAX_LIST),
    lcpMs: last?.timeMs ?? null,
  };
}

function analyzeLongTasks(events: TraceEvent[]) {
  const navStart = navigationStartTs(events);
  const tasks: Array<{
    name: string;
    durationMs: number;
    startMs: number;
    cat: string;
  }> = [];
  for (const ev of events) {
    if (typeof ev.dur !== "number" || ev.dur < LONG_TASK_US) continue;
    const name = eventName(ev);
    const cat = eventCat(ev);
    if (
      name !== "RunTask" &&
      !cat.includes("devtools.timeline") &&
      !cat.includes("toplevel")
    ) {
      continue;
    }
    const startMs =
      typeof ev.ts === "number"
        ? Math.round((ev.ts - navStart) / 1000)
        : 0;
    tasks.push({
      name,
      durationMs: Math.round(ev.dur / 1000),
      startMs,
      cat,
    });
  }
  tasks.sort((a, b) => b.durationMs - a.durationMs);
  return {
    thresholdMs: LONG_TASK_US / 1000,
    count: tasks.length,
    totalBlockingMs: tasks.reduce((sum, t) => sum + t.durationMs, 0),
    tasks: tasks.slice(0, MAX_LIST),
  };
}

function analyzeLayoutShifts(events: TraceEvent[]) {
  const shifts: Array<{
    timeMs: number;
    score?: number;
    hadRecentInput?: boolean;
  }> = [];
  const navStart = navigationStartTs(events);
  for (const ev of events) {
    const name = eventName(ev);
    if (
      !name.includes("LayoutShift") &&
      !name.includes("layout-shift") &&
      name !== "LayoutInvalidationTracking"
    ) {
      continue;
    }
    const args = ev.args ?? {};
    const data = (args.data as Record<string, unknown> | undefined) ?? args;
    const score =
      typeof data.score === "number"
        ? data.score
        : typeof data.weighted_score_delta === "number"
          ? data.weighted_score_delta
          : undefined;
    shifts.push({
      timeMs:
        typeof ev.ts === "number"
          ? Math.round((ev.ts - navStart) / 1000)
          : 0,
      score,
      hadRecentInput:
        typeof data.had_recent_input === "boolean"
          ? data.had_recent_input
          : undefined,
    });
  }
  const cls = shifts.reduce((sum, row) => sum + (row.score ?? 0), 0);
  return {
    shiftCount: shifts.length,
    estimatedCls: Number(cls.toFixed(4)),
    shifts: shifts.slice(0, MAX_LIST),
  };
}

function analyzeNetworkSummary(events: TraceEvent[]) {
  const navStart = navigationStartTs(events);
  const resources: Array<{
    url?: string;
    durationMs?: number;
    startMs: number;
    name: string;
  }> = [];
  for (const ev of events) {
    const name = eventName(ev);
    if (
      !name.startsWith("Resource") &&
      name !== "ResourceSendRequest" &&
      name !== "ResourceReceiveResponse" &&
      name !== "ResourceFinish"
    ) {
      continue;
    }
    const args = ev.args ?? {};
    const data = (args.data as Record<string, unknown> | undefined) ?? args;
    const url = typeof data.url === "string" ? data.url : undefined;
    resources.push({
      name,
      url,
      startMs:
        typeof ev.ts === "number"
          ? Math.round((ev.ts - navStart) / 1000)
          : 0,
      durationMs:
        typeof ev.dur === "number" ? Math.round(ev.dur / 1000) : undefined,
    });
  }
  const slow = resources
    .filter((r) => (r.durationMs ?? 0) >= 200)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, MAX_LIST);
  return {
    resourceEventCount: resources.length,
    slowResources: slow,
  };
}

function analyzeMainThreadTopTasks(events: TraceEvent[]) {
  const navStart = navigationStartTs(events);
  const tasks: Array<{
    name: string;
    durationMs: number;
    startMs: number;
  }> = [];
  for (const ev of events) {
    if (eventName(ev) !== "RunTask" || typeof ev.dur !== "number") continue;
    tasks.push({
      name: eventName(ev),
      durationMs: Math.round(ev.dur / 1000),
      startMs:
        typeof ev.ts === "number"
          ? Math.round((ev.ts - navStart) / 1000)
          : 0,
    });
  }
  tasks.sort((a, b) => b.durationMs - a.durationMs);
  return {
    topTasks: tasks.slice(0, MAX_LIST),
  };
}

function insightHasData(name: PerformanceInsightName, events: TraceEvent[]): boolean {
  switch (name) {
    case "DocumentLatency":
      return analyzeDocumentLatency(events).eventHits > 0;
    case "LCPBreakdown":
      return analyzeLcpBreakdown(events).candidateCount > 0;
    case "LongTasks":
      return analyzeLongTasks(events).count > 0;
    case "LayoutShifts":
      return analyzeLayoutShifts(events).shiftCount > 0;
    case "NetworkSummary":
      return analyzeNetworkSummary(events).resourceEventCount > 0;
    case "MainThreadTopTasks":
      return analyzeMainThreadTopTasks(events).topTasks.length > 0;
    default:
      return false;
  }
}

export function listAvailableInsights(events: TraceEvent[]): PerformanceInsightName[] {
  return PERFORMANCE_INSIGHT_NAMES.filter((name) => insightHasData(name, events));
}

export function analyzeTraceInsight(
  events: TraceEvent[],
  insightName: PerformanceInsightName,
): Record<string, unknown> {
  switch (insightName) {
    case "DocumentLatency":
      return { insightName, ...analyzeDocumentLatency(events) };
    case "LCPBreakdown":
      return { insightName, ...analyzeLcpBreakdown(events) };
    case "LongTasks":
      return { insightName, ...analyzeLongTasks(events) };
    case "LayoutShifts":
      return { insightName, ...analyzeLayoutShifts(events) };
    case "NetworkSummary":
      return { insightName, ...analyzeNetworkSummary(events) };
    case "MainThreadTopTasks":
      return { insightName, ...analyzeMainThreadTopTasks(events) };
    default:
      return { insightName, error: "Unknown insight." };
  }
}

export async function listAvailableInsightsFromFile(
  traceFile: string,
): Promise<PerformanceInsightName[]> {
  const events = await readTraceEvents(traceFile);
  return listAvailableInsights(events);
}

export async function analyzeTraceInsightFromFile(
  traceFile: string,
  insightNameInput: string,
): Promise<Record<string, unknown>> {
  const insightName = normalizeInsightName(insightNameInput);
  if (!insightName) {
    throw new Error(
      `未知 insight：${insightNameInput}。可用：${PERFORMANCE_INSIGHT_NAMES.join(", ")}`,
    );
  }
  const events = await readTraceEvents(traceFile);
  if (!insightHasData(insightName, events)) {
    return {
      ok: false,
      insightName,
      hint: `trace 中未找到 ${insightName} 相关事件。`,
      availableInsights: listAvailableInsights(events),
    };
  }
  return {
    ok: true,
    traceFile,
    ...analyzeTraceInsight(events, insightName),
  };
}

export function availableInsightsFromPageTiming(
  pageTiming: Record<string, unknown> | null,
): PerformanceInsightName[] {
  if (!pageTiming) return [];
  const out: PerformanceInsightName[] = [];
  if (
    pageTiming.domContentLoaded != null ||
    pageTiming.loadEventEnd != null ||
    pageTiming.firstContentfulPaint != null
  ) {
    out.push("DocumentLatency");
  }
  if (pageTiming.lcp != null || pageTiming.firstContentfulPaint != null) {
    out.push("LCPBreakdown");
  }
  return out;
}

/**
 * A134：从 CDP metrics + Performance API 汇总可读性能摘要。
 */
export type PerformanceInsights = {
  navigation?: {
    domContentLoadedMs?: number;
    loadEventEndMs?: number;
    transferSize?: number;
    encodedBodySize?: number;
  };
  paint?: {
    firstPaintMs?: number;
    firstContentfulPaintMs?: number;
  };
  lcpMs?: number;
  traceEventCount?: number;
};

type CdpMetric = { name?: string; value?: number };

export function summarizeCdpMetrics(metrics: CdpMetric[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of metrics) {
    if (row?.name && typeof row.value === "number") {
      out[row.name] = row.value;
    }
  }
  return out;
}

export function buildPerformanceInsights(
  pageTiming: Record<string, unknown> | null,
  metrics: CdpMetric[],
  traceEventCount: number,
): PerformanceInsights {
  const metricMap = summarizeCdpMetrics(metrics);
  const insights: PerformanceInsights = { traceEventCount };

  if (pageTiming && typeof pageTiming === "object") {
    if (typeof pageTiming.domContentLoaded === "number") {
      insights.navigation = {
        ...insights.navigation,
        domContentLoadedMs: pageTiming.domContentLoaded,
      };
    }
    if (typeof pageTiming.loadEventEnd === "number") {
      insights.navigation = {
        ...insights.navigation,
        loadEventEndMs: pageTiming.loadEventEnd,
      };
    }
    if (typeof pageTiming.transferSize === "number") {
      insights.navigation = {
        ...insights.navigation,
        transferSize: pageTiming.transferSize,
      };
    }
    if (typeof pageTiming.encodedBodySize === "number") {
      insights.navigation = {
        ...insights.navigation,
        encodedBodySize: pageTiming.encodedBodySize,
      };
    }
    if (typeof pageTiming.firstPaint === "number") {
      insights.paint = { ...insights.paint, firstPaintMs: pageTiming.firstPaint };
    }
    if (typeof pageTiming.firstContentfulPaint === "number") {
      insights.paint = {
        ...insights.paint,
        firstContentfulPaintMs: pageTiming.firstContentfulPaint,
      };
    }
    if (typeof pageTiming.lcp === "number") {
      insights.lcpMs = pageTiming.lcp;
    }
  }

  return insights;
}

/** 在 guest 页面读取 Navigation Timing + Paint + LCP（若可用）。 */
export const PERFORMANCE_TIMING_SCRIPT = `(function() {
  var nav = performance.getEntriesByType("navigation")[0];
  var paint = performance.getEntriesByType("paint");
  var fp = paint.find(function(p) { return p.name === "first-paint"; });
  var fcp = paint.find(function(p) { return p.name === "first-contentful-paint"; });
  var lcp = null;
  try {
    var lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    if (lcpEntries && lcpEntries.length) {
      lcp = lcpEntries[lcpEntries.length - 1].startTime;
    }
  } catch (e) {}
  return {
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
    loadEventEnd: nav ? nav.loadEventEnd : null,
    transferSize: nav ? nav.transferSize : null,
    encodedBodySize: nav ? nav.encodedBodySize : null,
    firstPaint: fp ? fp.startTime : null,
    firstContentfulPaint: fcp ? fcp.startTime : null,
    lcp: lcp,
  };
})()`;

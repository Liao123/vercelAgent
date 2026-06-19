/**
 * A135：最近一次 performance trace 元数据（供 analyze_insight 读取）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { PerformanceInsights } from "@/agent/devtools/performance-insights";

export type PerformanceLastRecording = {
  insightSetId: string;
  traceFile: string | null;
  traceTruncated: boolean;
  eventCount: number;
  pageTiming: Record<string, unknown> | null;
  insights: PerformanceInsights;
  availableInsights: string[];
  recordedAt: string;
};

const REL_PATH = ".agent-state/performance-last.json";

function lastFilePath(): string {
  return path.join(process.cwd(), REL_PATH);
}

export async function savePerformanceLastRecording(
  recording: PerformanceLastRecording,
): Promise<void> {
  const file = lastFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(recording, null, 2), "utf8");
}

export async function loadPerformanceLastRecording(): Promise<PerformanceLastRecording | null> {
  try {
    const raw = await fs.readFile(lastFilePath(), "utf8");
    return JSON.parse(raw) as PerformanceLastRecording;
  } catch {
    return null;
  }
}

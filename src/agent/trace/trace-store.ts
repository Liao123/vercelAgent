/**
 * Trace Store。
 *
 * Trace 同时写入内存 Map 和本地 JSON 文件。内存用于当前进程快速访问，
 * 文件用于刷新/重启后的恢复。后续如果需要查询能力，再替换为 SQLite。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, AgentId, Task, Thread, Turn } from "@/agent/types";

export type TraceRecord = {
  id: AgentId;
  thread?: Thread;
  task?: Task;
  turns: Turn[];
  events: AgentEvent[];
  createdAt: string;
  updatedAt: string;
};

const traces = new Map<string, TraceRecord>();
const TRACE_DIR = ".agent-traces";

function getTraceDir(): string {
  return path.join(process.cwd(), TRACE_DIR);
}

function getTracePath(traceId: string): string {
  const safeId = traceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getTraceDir(), `${safeId}.json`);
}

async function persistTrace(trace: TraceRecord): Promise<void> {
  await fs.mkdir(getTraceDir(), { recursive: true });
  await fs.writeFile(getTracePath(trace.id), JSON.stringify(trace, null, 2), "utf8");
}

function persistTraceSoon(trace: TraceRecord): void {
  void persistTrace(trace).catch((error) => {
    console.error("Failed to persist trace", trace.id, error);
  });
}

export function createTrace(record: Omit<TraceRecord, "events">): TraceRecord {
  const trace: TraceRecord = {
    ...record,
    events: [],
  };
  traces.set(trace.id, trace);
  persistTraceSoon(trace);
  return trace;
}

export function appendTraceEvent(traceId: string, event: AgentEvent): void {
  const trace = traces.get(traceId);
  if (!trace) return;
  trace.events.push(event);
  trace.updatedAt = new Date().toISOString();
  persistTraceSoon(trace);
}

export async function getTrace(traceId: string): Promise<TraceRecord | undefined> {
  const memoryTrace = traces.get(traceId);
  if (memoryTrace) return memoryTrace;

  try {
    const raw = await fs.readFile(getTracePath(traceId), "utf8");
    const trace = JSON.parse(raw) as TraceRecord;
    traces.set(trace.id, trace);
    return trace;
  } catch {
    return undefined;
  }
}

export async function listTraces(): Promise<TraceRecord[]> {
  const byId = new Map<string, TraceRecord>(traces);

  try {
    const entries = await fs.readdir(getTraceDir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(getTraceDir(), entry.name), "utf8");
      const trace = JSON.parse(raw) as TraceRecord;
      byId.set(trace.id, trace);
      traces.set(trace.id, trace);
    }
  } catch {
    // Missing trace directory is fine before the first task runs.
  }

  return [...byId.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/**
 * HAR-lite：结构化网络日志落盘（A025）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@/agent/types";

export type BrowserHarTiming = {
  dnsMs?: number;
  connectMs?: number;
  ttfbMs?: number;
};

export type BrowserHarEntry = {
  url: string;
  method: string;
  kind: "fetch" | "xhr" | "resource";
  status: number | null;
  durationMs: number | null;
  size: number | null;
  initiatorType?: string | null;
  error?: string | null;
  timing?: BrowserHarTiming;
};

export type BrowserHarLog = {
  capturedAt: string;
  pageUrl: string;
  entries: BrowserHarEntry[];
};

export type BrowserHarMeta = {
  filePath: string;
  entryCount: number;
  failedCount: number;
};

const STATE_DIR = ".agent-state";
const HAR_FILE = "browser-network.har.json";
const MAX_HAR_ENTRIES = 120;

function harPath(): string {
  return path.join(process.cwd(), STATE_DIR, HAR_FILE);
}

export function normalizeHarEntries(raw: unknown[]): BrowserHarEntry[] {
  const entries: BrowserHarEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url) continue;

    const method =
      typeof row.method === "string" && row.method.length > 0
        ? row.method.toUpperCase()
        : row.kind === "resource"
          ? "GET"
          : "GET";
    const kind =
      row.kind === "fetch" || row.kind === "xhr" || row.kind === "resource"
        ? row.kind
        : "resource";
    const status =
      typeof row.status === "number"
        ? row.status
        : row.status === null
          ? null
          : null;
    const key = `${kind}:${method}:${url}:${status ?? "?"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const timingRaw = row.timing as Record<string, unknown> | undefined;
    const timing: BrowserHarTiming | undefined =
      timingRaw && typeof timingRaw === "object"
        ? {
            dnsMs:
              typeof timingRaw.dnsMs === "number" ? timingRaw.dnsMs : undefined,
            connectMs:
              typeof timingRaw.connectMs === "number"
                ? timingRaw.connectMs
                : undefined,
            ttfbMs:
              typeof timingRaw.ttfbMs === "number" ? timingRaw.ttfbMs : undefined,
          }
        : undefined;

    entries.push({
      url,
      method,
      kind,
      status,
      durationMs:
        typeof row.durationMs === "number" ? Math.round(row.durationMs) : null,
      size: typeof row.size === "number" ? row.size : null,
      initiatorType:
        typeof row.initiatorType === "string" ? row.initiatorType : null,
      error: typeof row.error === "string" ? row.error : null,
      timing,
    });
    if (entries.length >= MAX_HAR_ENTRIES) break;
  }

  return entries;
}

export async function persistBrowserHarLog(input: {
  pageUrl: string;
  entries: BrowserHarEntry[];
}): Promise<BrowserHarMeta> {
  const log: BrowserHarLog = {
    capturedAt: nowIso(),
    pageUrl: input.pageUrl,
    entries: input.entries.slice(-MAX_HAR_ENTRIES),
  };
  const failedCount = log.entries.filter(
    (entry) =>
      entry.error ||
      (entry.status != null && entry.status >= 400) ||
      entry.status == null,
  ).length;

  await fs.mkdir(path.dirname(harPath()), { recursive: true });
  await fs.writeFile(harPath(), JSON.stringify(log, null, 2), "utf8");

  return {
    filePath: `${STATE_DIR}/${HAR_FILE}`,
    entryCount: log.entries.length,
    failedCount,
  };
}

export async function getPersistedBrowserHarLog(): Promise<BrowserHarLog | null> {
  try {
    const raw = await fs.readFile(harPath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserHarLog;
    if (!parsed.pageUrl || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getBrowserHarMeta(): Promise<BrowserHarMeta | null> {
  const log = await getPersistedBrowserHarLog();
  if (!log) return null;
  const failedCount = log.entries.filter(
    (entry) =>
      entry.error ||
      (entry.status != null && entry.status >= 400) ||
      (entry.kind !== "resource" && entry.status == null),
  ).length;
  return {
    filePath: `${STATE_DIR}/${HAR_FILE}`,
    entryCount: log.entries.length,
    failedCount,
  };
}

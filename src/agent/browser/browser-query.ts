/**
 * 浏览器 DOM 查询队列（Agent browser.query ↔ 桌面 WebView 执行）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@/agent/types";

export type BrowserQueryMatch = {
  tag: string;
  id: string | null;
  className: string | null;
  text: string;
  rect: { x: number; y: number; w: number; h: number } | null;
};

export type BrowserQueryResult = {
  selector: string;
  matches: BrowserQueryMatch[];
  completedAt: string;
  url: string | null;
};

export type PendingBrowserQuery = {
  selector: string;
  maxResults: number;
  queuedAt: string;
};

const STATE_DIR = ".agent-state";
const PENDING_FILE = "browser-query-pending.json";
const RESULT_FILE = "browser-query-result.json";

function pendingPath(): string {
  return path.join(process.cwd(), STATE_DIR, PENDING_FILE);
}

function resultPath(): string {
  return path.join(process.cwd(), STATE_DIR, RESULT_FILE);
}

export async function queueBrowserQuery(input: {
  selector: string;
  maxResults?: number;
}): Promise<PendingBrowserQuery> {
  const pending: PendingBrowserQuery = {
    selector: input.selector.trim(),
    maxResults: Math.min(Math.max(input.maxResults ?? 12, 1), 40),
    queuedAt: nowIso(),
  };
  if (!pending.selector) {
    throw new Error("selector is required.");
  }
  await fs.mkdir(path.dirname(pendingPath()), { recursive: true });
  await fs.writeFile(pendingPath(), JSON.stringify(pending, null, 2), "utf8");
  return pending;
}

export async function getPendingBrowserQuery(): Promise<PendingBrowserQuery | null> {
  try {
    const raw = await fs.readFile(pendingPath(), "utf8");
    const parsed = JSON.parse(raw) as PendingBrowserQuery;
    if (!parsed.selector || !parsed.queuedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingBrowserQuery(): Promise<void> {
  try {
    await fs.unlink(pendingPath());
  } catch {
    // missing is fine
  }
}

export async function saveBrowserQueryResult(
  result: BrowserQueryResult,
): Promise<BrowserQueryResult> {
  await fs.mkdir(path.dirname(resultPath()), { recursive: true });
  await fs.writeFile(resultPath(), JSON.stringify(result, null, 2), "utf8");
  return result;
}

export async function getBrowserQueryResult(): Promise<BrowserQueryResult | null> {
  try {
    const raw = await fs.readFile(resultPath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserQueryResult;
    if (!parsed.selector || !parsed.completedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function waitForBrowserQueryResult(input: {
  selector: string;
  queuedAt: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<BrowserQueryResult | null> {
  const timeoutMs = input.timeoutMs ?? 6_000;
  const pollMs = input.pollMs ?? 400;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await getBrowserQueryResult();
    if (
      result &&
      result.selector === input.selector &&
      result.completedAt >= input.queuedAt
    ) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

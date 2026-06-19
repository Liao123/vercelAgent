/**
 * 内置浏览器状态。
 *
 * Web 阶段先用进程内状态记录要打开的 URL；后续 Electron/agent-server
 * 可以把这里替换成真实 WebView 或 Chrome DevTools 控制面。
 */
import { nowIso } from "@/agent/types";
import fs from "node:fs/promises";
import path from "node:path";

export type BrowserRequestedBy = "user" | "agent" | "system";

export type BrowserTarget = {
  url: string;
  requestedBy: BrowserRequestedBy;
  openedAt: string;
  updatedAt: string;
  version: number;
};

export type OpenBrowserUrlInput = {
  url: string;
  requestedBy?: BrowserRequestedBy;
  newTab?: boolean;
  tabId?: string;
};

let browserTarget: BrowserTarget | null = null;
let browserVersion = 0;

const STATE_DIR = ".agent-state";
const STATE_FILE = "browser.json";

const URL_REGEX =
  /(https?:\/\/[^\s"'<>，。；]+|(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'<>，。；]*)?)/i;

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;，。；）]+$/u, "");
}

export function normalizeBrowserUrl(input: string): string {
  const trimmed = stripTrailingPunctuation(input.trim());
  if (!trimmed) {
    throw new Error("url is required.");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported in the web preview.");
  }

  return url.toString();
}

export function extractFirstOpenableUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  if (!match?.[0]) return null;

  try {
    return normalizeBrowserUrl(match[0]);
  } catch {
    return null;
  }
}

export function getBrowserTarget(): BrowserTarget | null {
  return browserTarget;
}

function statePath(): string {
  return path.join(process.cwd(), STATE_DIR, STATE_FILE);
}

async function readBrowserTargetFromDisk(): Promise<BrowserTarget | null> {
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserTarget;
    if (!parsed.url || typeof parsed.version !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeBrowserTargetToDisk(target: BrowserTarget): Promise<void> {
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(target, null, 2), "utf8");
}

export async function getPersistedBrowserTarget(): Promise<BrowserTarget | null> {
  const { getBrowserTabsState, getActiveBrowserTab, tabToBrowserTarget } =
    await import("@/agent/browser/browser-tabs");
  const state = await getBrowserTabsState();
  const tab = await getActiveBrowserTab();
  if (!tab?.url) return null;
  return tabToBrowserTarget(tab, state.version);
}

export async function openBrowserUrl(
  input: OpenBrowserUrlInput & { newTab?: boolean; tabId?: string },
): Promise<BrowserTarget> {
  const { openBrowserUrlInTabs } = await import("@/agent/browser/browser-tabs");
  const { tab, state } = await openBrowserUrlInTabs({
    url: input.url,
    requestedBy: input.requestedBy,
    newTab: input.newTab,
    tabId: input.tabId,
  });
  return tabToBrowserTargetFromTab(tab, state.version);
}

function tabToBrowserTargetFromTab(
  tab: import("@/agent/browser/browser-tabs").BrowserTab,
  stateVersion: number,
): BrowserTarget {
  return {
    url: tab.url,
    requestedBy: tab.requestedBy,
    openedAt: tab.openedAt,
    updatedAt: tab.updatedAt,
    version: stateVersion,
  };
}

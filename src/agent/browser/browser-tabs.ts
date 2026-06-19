/**
 * A133：内置浏览器多标签状态（Codex list_pages / new_page / switch_page）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nowIso } from "@/agent/types";
import {
  normalizeBrowserUrl,
  type BrowserRequestedBy,
  type BrowserTarget,
} from "@/agent/browser/browser-state";

export type BrowserTab = {
  id: string;
  url: string;
  title: string | null;
  requestedBy: BrowserRequestedBy;
  openedAt: string;
  updatedAt: string;
  version: number;
  guestWebContentsId: number | null;
};

export type BrowserTabsState = {
  tabs: BrowserTab[];
  activeTabId: string;
  version: number;
};

const STATE_DIR = ".agent-state";
const TABS_FILE = "browser-tabs.json";
const LEGACY_FILE = "browser.json";

const MAX_TABS = 8;

let memoryState: BrowserTabsState | null = null;

function tabsPath(): string {
  return path.join(process.cwd(), STATE_DIR, TABS_FILE);
}

function legacyPath(): string {
  return path.join(process.cwd(), STATE_DIR, LEGACY_FILE);
}

function newTabId(): string {
  return randomUUID().slice(0, 8);
}

function createEmptyTab(requestedBy: BrowserRequestedBy = "user"): BrowserTab {
  const now = nowIso();
  return {
    id: newTabId(),
    url: "",
    title: null,
    requestedBy,
    openedAt: now,
    updatedAt: now,
    version: 1,
    guestWebContentsId: null,
  };
}

async function migrateLegacyBrowserFile(): Promise<BrowserTabsState | null> {
  try {
    const raw = await fs.readFile(legacyPath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserTarget;
    if (!parsed.url) return null;
    const tab: BrowserTab = {
      id: newTabId(),
      url: parsed.url,
      title: null,
      requestedBy: parsed.requestedBy ?? "user",
      openedAt: parsed.openedAt ?? nowIso(),
      updatedAt: parsed.updatedAt ?? nowIso(),
      version: parsed.version ?? 1,
      guestWebContentsId: null,
    };
    return {
      tabs: [tab],
      activeTabId: tab.id,
      version: parsed.version ?? 1,
    };
  } catch {
    return null;
  }
}

async function readTabsFromDisk(): Promise<BrowserTabsState | null> {
  try {
    const raw = await fs.readFile(tabsPath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserTabsState;
    if (!Array.isArray(parsed.tabs) || !parsed.activeTabId) return null;
    return parsed;
  } catch {
    return await migrateLegacyBrowserFile();
  }
}

async function writeTabsToDisk(state: BrowserTabsState): Promise<void> {
  await fs.mkdir(path.dirname(tabsPath()), { recursive: true });
  await fs.writeFile(tabsPath(), JSON.stringify(state, null, 2), "utf8");
}

function bumpState(state: BrowserTabsState): BrowserTabsState {
  return { ...state, version: state.version + 1 };
}

export async function getBrowserTabsState(): Promise<BrowserTabsState> {
  if (memoryState) return memoryState;
  const persisted = await readTabsFromDisk();
  if (persisted) {
    memoryState = persisted;
    return persisted;
  }
  const empty = createEmptyTab("system");
  memoryState = {
    tabs: [empty],
    activeTabId: empty.id,
    version: 1,
  };
  await writeTabsToDisk(memoryState);
  return memoryState;
}

export async function getActiveBrowserTab(): Promise<BrowserTab | null> {
  const state = await getBrowserTabsState();
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function tabToBrowserTarget(
  tab: BrowserTab,
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

export async function listBrowserTabs(): Promise<BrowserTab[]> {
  const state = await getBrowserTabsState();
  return state.tabs;
}

export async function createBrowserTab(input?: {
  url?: string;
  requestedBy?: BrowserRequestedBy;
}): Promise<BrowserTabsState> {
  const state = await getBrowserTabsState();
  if (state.tabs.length >= MAX_TABS) {
    throw new Error(`最多 ${MAX_TABS} 个浏览器标签。请先关闭部分标签。`);
  }

  const now = nowIso();
  const requestedBy = input?.requestedBy ?? "user";
  const tab: BrowserTab = {
    id: newTabId(),
    url: input?.url ? normalizeBrowserUrl(input.url) : "",
    title: null,
    requestedBy,
    openedAt: now,
    updatedAt: now,
    version: 1,
    guestWebContentsId: null,
  };

  const next = bumpState({
    ...state,
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
  });
  memoryState = next;
  await writeTabsToDisk(next);
  return next;
}

export async function switchBrowserTab(tabId: string): Promise<BrowserTabsState> {
  const state = await getBrowserTabsState();
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    throw new Error(`标签不存在：${tabId}`);
  }
  const next = bumpState({ ...state, activeTabId: tabId });
  memoryState = next;
  await writeTabsToDisk(next);
  return next;
}

export async function closeBrowserTab(tabId: string): Promise<BrowserTabsState> {
  const state = await getBrowserTabsState();
  const remaining = state.tabs.filter((tab) => tab.id !== tabId);
  if (remaining.length === state.tabs.length) {
    throw new Error(`标签不存在：${tabId}`);
  }
  if (remaining.length === 0) {
    const fresh = createEmptyTab("user");
    const next = bumpState({
      tabs: [fresh],
      activeTabId: fresh.id,
      version: state.version,
    });
    memoryState = next;
    await writeTabsToDisk(next);
    return next;
  }

  const activeTabId =
    state.activeTabId === tabId
      ? remaining[remaining.length - 1]!.id
      : state.activeTabId;

  const next = bumpState({
    ...state,
    tabs: remaining,
    activeTabId,
  });
  memoryState = next;
  await writeTabsToDisk(next);
  return next;
}

export async function updateBrowserTab(
  tabId: string,
  patch: Partial<Pick<BrowserTab, "url" | "title" | "guestWebContentsId">>,
): Promise<BrowserTab> {
  const state = await getBrowserTabsState();
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) throw new Error(`标签不存在：${tabId}`);

  const now = nowIso();
  const current = state.tabs[index]!;
  const updated: BrowserTab = {
    ...current,
    ...patch,
    updatedAt: now,
    version: patch.url && patch.url !== current.url ? current.version + 1 : current.version,
  };

  const tabs = [...state.tabs];
  tabs[index] = updated;
  const next = bumpState({ ...state, tabs });
  memoryState = next;
  await writeTabsToDisk(next);
  return updated;
}

export async function setBrowserTabGuest(
  tabId: string,
  guestWebContentsId: number,
): Promise<void> {
  await updateBrowserTab(tabId, { guestWebContentsId });
}

export async function openBrowserUrlInTabs(input: {
  url: string;
  requestedBy?: BrowserRequestedBy;
  newTab?: boolean;
  tabId?: string;
}): Promise<{ tab: BrowserTab; state: BrowserTabsState }> {
  const normalized = normalizeBrowserUrl(input.url);
  const requestedBy = input.requestedBy ?? "user";
  let state = await getBrowserTabsState();

  if (input.newTab) {
    state = await createBrowserTab({ url: normalized, requestedBy });
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) throw new Error("创建标签失败。");
    return { tab, state };
  }

  const targetTabId = input.tabId ?? state.activeTabId;
  const tab = await updateBrowserTab(targetTabId, {
    url: normalized,
    title: null,
  });
  state = await getBrowserTabsState();
  const tabIndex = state.tabs.findIndex((t) => t.id === tab.id);
  if (tabIndex >= 0) {
    const tabs = [...state.tabs];
    tabs[tabIndex] = { ...tab, requestedBy };
    state = bumpState({ ...state, tabs });
    memoryState = state;
    await writeTabsToDisk(state);
  }
  return { tab: { ...tab, requestedBy }, state };
}

export type BrowserPageInfo = {
  tabId: string;
  guestId: number | null;
  url: string;
  title: string | null;
  active: boolean;
  index: number;
};

export async function listBrowserPages(): Promise<BrowserPageInfo[]> {
  const state = await getBrowserTabsState();
  return state.tabs.map((tab, index) => ({
    tabId: tab.id,
    guestId: tab.guestWebContentsId,
    url: tab.url,
    title: tab.title,
    active: tab.id === state.activeTabId,
    index,
  }));
}

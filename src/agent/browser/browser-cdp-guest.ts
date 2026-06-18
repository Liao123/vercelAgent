/**
 * 持久化当前 WebView guest id（Agent CDP 桥使用）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@/agent/types";

const STATE_DIR = ".agent-state";
const GUEST_FILE = "browser-cdp-guest.json";

export type BrowserCdpGuestState = {
  guestWebContentsId: number;
  browserVersion?: number;
  updatedAt: string;
};

function guestPath(): string {
  return path.join(process.cwd(), STATE_DIR, GUEST_FILE);
}

export async function persistBrowserCdpGuest(input: {
  guestWebContentsId: number;
  browserVersion?: number;
}): Promise<BrowserCdpGuestState> {
  const state: BrowserCdpGuestState = {
    guestWebContentsId: input.guestWebContentsId,
    browserVersion: input.browserVersion,
    updatedAt: nowIso(),
  };
  await fs.mkdir(path.dirname(guestPath()), { recursive: true });
  await fs.writeFile(guestPath(), JSON.stringify(state, null, 2), "utf8");
  return state;
}

export async function getPersistedBrowserCdpGuest(): Promise<BrowserCdpGuestState | null> {
  try {
    const raw = await fs.readFile(guestPath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserCdpGuestState;
    if (!Number.isFinite(parsed.guestWebContentsId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 浏览器预览快照（A023 MVP）：桌面 WebView / 客户端上报的页面摘要。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@/agent/types";

export type BrowserPageSnapshot = {
  url: string;
  title: string | null;
  textPreview: string | null;
  capturedAt: string;
  source: "webview" | "iframe";
};

const STATE_DIR = ".agent-state";
const STATE_FILE = "browser-snapshot.json";

let memorySnapshot: BrowserPageSnapshot | null = null;

function statePath(): string {
  return path.join(process.cwd(), STATE_DIR, STATE_FILE);
}

export function getBrowserPageSnapshot(): BrowserPageSnapshot | null {
  return memorySnapshot;
}

export async function getPersistedBrowserPageSnapshot(): Promise<BrowserPageSnapshot | null> {
  if (memorySnapshot) return memorySnapshot;
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as BrowserPageSnapshot;
    if (!parsed.url || !parsed.capturedAt) return null;
    memorySnapshot = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveBrowserPageSnapshot(
  input: Omit<BrowserPageSnapshot, "capturedAt"> & { capturedAt?: string },
): Promise<BrowserPageSnapshot> {
  const snapshot: BrowserPageSnapshot = {
    url: input.url,
    title: input.title ?? null,
    textPreview: input.textPreview?.slice(0, 4_000) ?? null,
    source: input.source,
    capturedAt: input.capturedAt ?? nowIso(),
  };
  memorySnapshot = snapshot;
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

/**
 * 浏览器预览快照（A023 MVP）：桌面 WebView / 客户端上报的页面摘要。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeHarEntries,
  persistBrowserHarLog,
  type BrowserHarMeta,
} from "@/agent/browser/browser-har";
import { nowIso } from "@/agent/types";

export type BrowserConsoleMessage = {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  line?: number;
  sourceId?: string;
};

export type BrowserNetworkEntry = {
  url: string;
  kind: "resource" | "fetch" | "xhr";
  status?: number | null;
  durationMs?: number;
  size?: number;
  error?: string | null;
};

export type BrowserScreenshotMeta = {
  filePath: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: "image/jpeg";
};

export type BrowserPageSnapshot = {
  url: string;
  title: string | null;
  textPreview: string | null;
  capturedAt: string;
  source: "webview" | "iframe";
  /** 桌面 WebView console-message 采集（CDP-lite）。 */
  consoleMessages?: BrowserConsoleMessage[];
  /** 可交互元素与标题的轻量 DOM 大纲。 */
  domOutline?: string | null;
  /** window error / unhandledrejection。 */
  pageErrors?: string[];
  loadError?: string | null;
  /** Performance resource + fetch 失败摘要。 */
  networkEvents?: BrowserNetworkEntry[];
  /** 桌面 WebView capturePage 截图（JPEG 落盘路径）。 */
  screenshot?: BrowserScreenshotMeta | null;
  /** HAR-lite 落盘摘要（完整条目见 `.agent-state/browser-network.har.json`）。 */
  harLog?: BrowserHarMeta | null;
};

const STATE_DIR = ".agent-state";
const STATE_FILE = "browser-snapshot.json";
const SCREENSHOT_FILE = "browser-screenshot.jpg";
const MAX_SCREENSHOT_BYTES = 220_000;

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

function screenshotPath(): string {
  return path.join(process.cwd(), STATE_DIR, SCREENSHOT_FILE);
}

async function persistScreenshot(input: {
  jpegBase64: string;
  width: number;
  height: number;
}): Promise<BrowserScreenshotMeta | null> {
  const buf = Buffer.from(input.jpegBase64, "base64");
  if (buf.length === 0 || buf.length > MAX_SCREENSHOT_BYTES) return null;
  await fs.mkdir(path.dirname(screenshotPath()), { recursive: true });
  await fs.writeFile(screenshotPath(), buf);
  return {
    filePath: `${STATE_DIR}/${SCREENSHOT_FILE}`,
    width: input.width,
    height: input.height,
    bytes: buf.length,
    mimeType: "image/jpeg",
  };
}

export async function saveBrowserPageSnapshot(
  input: Omit<
    BrowserPageSnapshot,
    "capturedAt" | "screenshot" | "harLog" | "networkEvents"
  > & {
    capturedAt?: string;
    screenshotJpegBase64?: string | null;
    screenshotWidth?: number;
    screenshotHeight?: number;
    harEntries?: unknown[];
    networkEvents?: BrowserNetworkEntry[];
  },
): Promise<BrowserPageSnapshot> {
  let screenshot: BrowserScreenshotMeta | null = null;
  if (
    input.screenshotJpegBase64 &&
    input.screenshotWidth != null &&
    input.screenshotHeight != null
  ) {
    screenshot = await persistScreenshot({
      jpegBase64: input.screenshotJpegBase64,
      width: input.screenshotWidth,
      height: input.screenshotHeight,
    });
  }

  let harLog: BrowserHarMeta | null = null;
  let networkEvents = input.networkEvents?.slice(-48);
  if (input.harEntries && input.harEntries.length > 0) {
    const entries = normalizeHarEntries(input.harEntries);
    harLog = await persistBrowserHarLog({
      pageUrl: input.url,
      entries,
    });
    if (!networkEvents?.length) {
      networkEvents = entries.slice(-48).map((entry) => ({
        url: entry.url,
        kind: entry.kind,
        status: entry.status,
        durationMs: entry.durationMs ?? undefined,
        size: entry.size ?? undefined,
        error: entry.error ?? null,
      }));
    }
  }

  const snapshot: BrowserPageSnapshot = {
    url: input.url,
    title: input.title ?? null,
    textPreview: input.textPreview?.slice(0, 4_000) ?? null,
    source: input.source,
    capturedAt: input.capturedAt ?? nowIso(),
    consoleMessages: input.consoleMessages?.slice(-30),
    domOutline: input.domOutline?.slice(0, 4_000) ?? null,
    pageErrors: input.pageErrors?.slice(-20),
    loadError: input.loadError ?? null,
    networkEvents,
    screenshot: screenshot ?? null,
    harLog,
  };
  memorySnapshot = snapshot;
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

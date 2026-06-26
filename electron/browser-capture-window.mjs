/**
 * Hidden BrowserWindow screenshots: capture outside the right-rail webview size.
 */
import { BrowserWindow } from "electron";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DESIGN_ARTBOARD_PROBE = `(() => {
  try {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "0",
        code: "Digit0",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  } catch {}
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = vw / 2;
  const cy = vh / 2;
  function score(r) {
    if (r.width < 80 || r.height < 80) return -1;
    const ax = r.left + r.width / 2;
    const ay = r.top + r.height / 2;
    const dist = Math.hypot(ax - cx, ay - cy);
    const area = r.width * r.height;
    if (area > vw * vh * 0.92) return -1;
    return area - dist * 40;
  }
  const selectors = [
    "canvas",
    "svg[width][height]",
    '[class*="artboard"]',
    '[class*="frame"]',
    '[class*="board"]',
  ];
  let best = null;
  let bestScore = -1;
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const s = score(r);
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
  }
  if (!best) return null;
  const pad = 12;
  return {
    x: Math.max(0, Math.floor(best.x - pad)),
    y: Math.max(0, Math.floor(best.y - pad)),
    width: Math.min(vw, Math.ceil(best.width + pad * 2)),
    height: Math.min(vh, Math.ceil(best.height + pad * 2)),
  };
})()`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPageReady(win, timeoutMs) {
  const wc = win.webContents;
  const isUsable = async () => {
    if (wc.isDestroyed()) return false;
    try {
      const state = await wc.executeJavaScript(
        `({
          readyState: document.readyState,
          hasBody: Boolean(document.body),
          textLength: document.body ? document.body.innerText.length : 0,
          title: document.title || ""
        })`,
        true,
      );
      return (
        state?.readyState === "interactive" ||
        state?.readyState === "complete" ||
        state?.hasBody === true ||
        state?.textLength > 0 ||
        Boolean(state?.title)
      );
    } catch {
      return false;
    }
  };

  if (await isUsable()) {
    await sleep(600);
    return;
  }

  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setTimeout(async () => {
      if (await isUsable()) {
        cleanup();
        resolve();
        return;
      }
      cleanup();
      reject(new Error("Hidden window load timed out."));
    }, timeoutMs);
    const poller = setInterval(async () => {
      if (Date.now() - startedAt < 500 && wc.isLoading()) return;
      if (!(await isUsable())) return;
      cleanup();
      resolve();
    }, 250);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onFail = (_event, code, desc, _validatedUrl, isMainFrame) => {
      if (isMainFrame === false) return;
      cleanup();
      reject(new Error(`Page load failed (${code}): ${desc}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poller);
      wc.removeListener("dom-ready", onReady);
      wc.removeListener("did-finish-load", onReady);
      wc.removeListener("did-stop-loading", onReady);
      wc.removeListener("did-fail-load", onFail);
    };
    wc.once("dom-ready", onReady);
    wc.once("did-finish-load", onReady);
    wc.once("did-stop-loading", onReady);
    wc.on("did-fail-load", onFail);
  });

  await sleep(600);
}

async function captureWithCdp(wc, options) {
  const quality = options.quality ?? 72;
  const mode = options.mode ?? "viewport";
  const baseParams = { format: "jpeg", quality, fromSurface: true };

  if (!wc.debugger.isAttached()) {
    wc.debugger.attach("1.3");
  }
  await wc.debugger.sendCommand("Page.enable");

  let params = { ...baseParams };
  let capturedMode = mode;

  if (mode === "designArtboard") {
    await sleep(400);
    const probe = await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: DESIGN_ARTBOARD_PROBE,
      returnByValue: true,
      awaitPromise: true,
    });
    const clip = probe?.result?.value;
    if (clip?.width > 0 && clip?.height > 0) {
      params = {
        ...baseParams,
        captureBeyondViewport: true,
        clip: {
          x: clip.x,
          y: clip.y,
          width: clip.width,
          height: clip.height,
          scale: 1,
        },
      };
      capturedMode = "designArtboard";
    }
  } else if (mode === "fullPage") {
    try {
      const layout = await wc.debugger.sendCommand("Page.getLayoutMetrics");
      const content = layout?.cssContentSize ?? layout?.contentSize ?? null;
      if (content?.width && content?.height) {
        params = {
          ...baseParams,
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width: Math.min(Math.ceil(content.width), 2560),
            height: Math.min(Math.ceil(content.height), 6000),
            scale: 1,
          },
        };
        capturedMode = "fullPage";
      }
    } catch {
      /* viewport fallback */
    }
  }

  const result = await wc.debugger.sendCommand("Page.captureScreenshot", params);
  const data = result?.data;
  if (!data || typeof data !== "string") {
    return { ok: false, error: "Hidden window screenshot was empty." };
  }
  return {
    ok: true,
    jpegBase64: data,
    captureWindow: true,
    mode: capturedMode,
    clip: params.clip ?? null,
  };
}

/**
 * @param {string} url
 * @param {{
 *   viewportWidth?: number;
 *   viewportHeight?: number;
 *   quality?: number;
 *   mode?: 'viewport' | 'fullPage' | 'designArtboard';
 *   waitMs?: number;
 *   userAgent?: string;
 * }} [options]
 */
export async function captureUrlInHiddenWindow(url, options = {}) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    return { ok: false, error: "A valid http(s) URL is required." };
  }

  const targetUrl = url.trim();
  const width = Math.min(Math.max(options.viewportWidth ?? 1920, 320), 3840);
  const height = Math.min(Math.max(options.viewportHeight ?? 1080, 240), 2160);
  const waitMs = options.waitMs ?? 25_000;

  const win = new BrowserWindow({
    show: false,
    width,
    height,
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    const loadPromise = win.loadURL(targetUrl, {
      userAgent: options.userAgent ?? DEFAULT_UA,
    });
    await waitForPageReady(win, waitMs);
    loadPromise.catch(() => {
      /* waitForPageReady reports main-frame failures; late loadURL rejections can be ignored. */
    });

    const shot = await captureWithCdp(win.webContents, options);
    if (!shot.ok) return shot;

    return {
      ...shot,
      url: targetUrl,
      viewportWidth: width,
      viewportHeight: height,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Hidden window screenshot failed.",
    };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

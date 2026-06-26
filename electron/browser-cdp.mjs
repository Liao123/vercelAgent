/**
 * Codex 级内置浏览器 CDP：附着 <webview> guest，提供 IPC + 本地 HTTP 桥供 Agent 调用。
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, webContents } from "electron";
import { captureUrlInHiddenWindow } from "./browser-capture-window.mjs";

const BRIDGE_PORT = Number(process.env.VEC_CDP_BRIDGE_PORT ?? 19229);
const MAX_CONSOLE = 80;
const MAX_NETWORK = 200;
const MAX_TRACE_EVENTS = 80_000;
const TRACE_COMPLETE_WAIT_MS = 20_000;
const PERF_TRACE_CATEGORIES = [
  "-*",
  "blink.console",
  "blink.user_timing",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "loading",
  "v8.execute",
].join(",");

/** @type {Map<number, GuestCdpState>} */
const guests = new Map();

/** @type {number | null} */
let activeGuestId = null;

/** @type {http.Server | null} */
let bridgeServer = null;

function guestState(contentsId) {
  return guests.get(contentsId);
}

function guestFromId(guestId) {
  const id = Number(guestId);
  if (!Number.isFinite(id)) return null;
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed()) return null;
  return wc;
}

function resolveGuestId(guestId) {
  const id = Number(guestId);
  if (Number.isFinite(id) && guestFromId(id)) return id;
  if (activeGuestId != null && guestFromId(activeGuestId)) return activeGuestId;
  return null;
}

function getGuestUrl(guestId) {
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) return null;
  const href = wc.getURL();
  if (typeof href !== "string" || !/^https?:\/\//i.test(href)) return null;
  return href;
}

async function writeBridgeState(baseUrl) {
  const cwd = process.cwd();
  const dir = path.join(cwd, ".agent-state");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "cdp-bridge.json"),
    JSON.stringify({ baseUrl, port: BRIDGE_PORT, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

async function attachBrowserGuest(contents) {
  if (!contents || contents.isDestroyed()) return false;
  if (contents.getType() !== "webview") return false;

  const existing = guests.get(contents.id);
  if (existing?.attached) return true;

  try {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
    }

    const state = {
      attached: true,
      network: existing?.network ?? [],
      /** @type {Map<string, Record<string, unknown>>} */
      requests: existing?.requests ?? new Map(),
      console: existing?.console ?? [],
      exceptions: existing?.exceptions ?? [],
      tracingActive: existing?.tracingActive ?? false,
      traceChunks: existing?.traceChunks ?? [],
      /** @type {Array<() => void>} */
      traceCompleteResolvers: existing?.traceCompleteResolvers ?? [],
    };
    guests.set(contents.id, state);
    activeGuestId = contents.id;

    const enable = async (method, params = {}) => {
      await contents.debugger.sendCommand(method, params);
    };

    await enable("Network.enable", {
      maxTotalBufferSize: 0,
      maxResourceBufferSize: 0,
    });
    await enable("Page.enable");
    await enable("DOM.enable");
    await enable("Runtime.enable");
    await enable("Log.enable");
    await enable("Accessibility.enable");

    contents.debugger.on("message", (_event, method, params) => {
      if (method === "Network.requestWillBeSent") {
        const requestId = params?.requestId;
        const request = params?.request;
        if (!requestId || !request?.url) return;
        state.requests.set(String(requestId), {
          requestId: String(requestId),
          url: String(request.url),
          method: request.method ?? "GET",
          type: params.type ?? null,
          startedAt: Date.now(),
        });
        return;
      }

      if (method === "Network.responseReceived") {
        const requestId = params?.requestId;
        const response = params?.response;
        if (!requestId || !response?.url) return;
        const key = String(requestId);
        const row = state.requests.get(key) ?? {
          requestId: key,
          url: String(response.url),
          method: "GET",
        };
        row.status =
          typeof response.status === "number" ? response.status : null;
        row.mimeType =
          typeof response.mimeType === "string" ? response.mimeType : null;
        state.requests.set(key, row);
        state.network.push({
          url: row.url,
          method: row.method,
          status: row.status,
          mimeType: row.mimeType,
          kind: "resource",
        });
        if (state.network.length > MAX_NETWORK) {
          state.network.splice(0, state.network.length - MAX_NETWORK);
        }
        return;
      }

      if (method === "Runtime.consoleAPICalled") {
        const args = (params?.args ?? []).map((a) => a?.value ?? a?.description ?? "");
        const message = args.join(" ").slice(0, 500);
        state.console.push({
          level: params?.type ?? "log",
          message,
          timestamp: Date.now(),
        });
        if (state.console.length > MAX_CONSOLE) state.console.shift();
        return;
      }

      if (method === "Runtime.exceptionThrown") {
        const details = params?.exceptionDetails;
        const text =
          details?.text ??
          details?.exception?.description ??
          "Runtime exception";
        state.exceptions.push({
          message: String(text).slice(0, 500),
          line: details?.lineNumber,
          url: details?.url,
          timestamp: Date.now(),
        });
        if (state.exceptions.length > MAX_CONSOLE) state.exceptions.shift();
        return;
      }

      if (method === "Log.entryAdded") {
        const entry = params?.entry;
        if (!entry?.text) return;
        state.console.push({
          level: entry.level ?? "log",
          message: String(entry.text).slice(0, 500),
          source: entry.source,
          timestamp: Date.now(),
        });
        if (state.console.length > MAX_CONSOLE) state.console.shift();
        return;
      }

      if (method === "Tracing.dataCollected") {
        const values = params?.value;
        if (!Array.isArray(values) || !state.traceChunks) return;
        state.traceChunks.push(...values);
        if (state.traceChunks.length >= MAX_TRACE_EVENTS) {
          state.tracingActive = false;
        }
        return;
      }

      if (method === "Tracing.tracingComplete") {
        state.tracingActive = false;
        const resolvers = state.traceCompleteResolvers ?? [];
        state.traceCompleteResolvers = [];
        for (const resolve of resolvers) resolve();
      }
    });

    return true;
  } catch {
    guests.delete(contents.id);
    return false;
  }
}

async function captureGuestScreenshot(guestId, options = {}) {
  const fullPage = options.fullPage !== false;
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) {
    return { ok: false, error: "WebView 未就绪。请打开右栏浏览器并加载页面。" };
  }
  await attachBrowserGuest(wc);

  const baseParams = {
    format: "jpeg",
    quality: options.quality ?? 65,
    fromSurface: true,
  };

  let params = { ...baseParams };
  let capturedFullPage = false;

  if (fullPage) {
    try {
      const layout = await wc.debugger.sendCommand("Page.getLayoutMetrics");
      const content = layout?.cssContentSize ?? layout?.contentSize ?? null;
      if (content?.width && content?.height) {
        const width = Math.min(Math.ceil(content.width), 2560);
        const height = Math.min(Math.ceil(content.height), 6000);
        params = {
          ...baseParams,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        };
        capturedFullPage = true;
      }
    } catch {
      /* 回退为可视区域截图 */
    }
  }

  try {
    const result = await wc.debugger.sendCommand(
      "Page.captureScreenshot",
      params,
    );
    const data = result?.data;
    if (!data || typeof data !== "string") {
      return { ok: false, error: "截图为空。" };
    }
    return {
      ok: true,
      jpegBase64: data,
      guestId: wc.id,
      fullPage: capturedFullPage,
      clip: params.clip ?? null,
    };
  } catch (error) {
    if (fullPage && capturedFullPage) {
      return captureGuestScreenshot(guestId, { fullPage: false, quality: 72 });
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "截图失败。",
    };
  }
}

async function sendCdp(guestId, method, params = {}) {
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) {
    return { ok: false, error: "WebView 未就绪。请打开右栏浏览器并加载页面。" };
  }
  await attachBrowserGuest(wc);
  try {
    const result = await wc.debugger.sendCommand(method, params);
    return { ok: true, result, guestId: wc.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "CDP 调用失败。",
    };
  }
}

async function evaluateJson(wc, expression) {
  const payload = await wc.debugger.sendCommand("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (payload?.exceptionDetails) {
    return {
      ok: false,
      error:
        payload.exceptionDetails.text ??
        payload.exceptionDetails.exception?.description ??
        "Runtime.evaluate failed",
    };
  }
  return { ok: true, value: payload?.result?.value };
}

async function clickSelector(guestId, selector) {
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) return { ok: false, error: "WebView 未就绪。" };
  await attachBrowserGuest(wc);

  const sel = JSON.stringify(selector);
  const ev = await evaluateJson(
    wc,
    `(function(){
      const el = document.querySelector(${sel});
      if (!el) return { ok: false, error: "selector not found" };
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  if (!ev.ok || !ev.value?.ok) {
    return { ok: false, error: ev.value?.error ?? ev.error ?? "元素未找到。" };
  }

  const x = Math.round(ev.value.x);
  const y = Math.round(ev.value.y);
  try {
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    return { ok: true, x, y, selector, guestId: wc.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "点击失败。",
    };
  }
}

async function typeSelector(guestId, selector, text) {
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) return { ok: false, error: "WebView 未就绪。" };
  await attachBrowserGuest(wc);

  const sel = JSON.stringify(selector);
  const ev = await evaluateJson(
    wc,
    `(function(){
      const el = document.querySelector(${sel});
      if (!el) return { ok: false, error: "selector not found" };
      el.scrollIntoView({ block: "center" });
      el.focus();
      return { ok: true };
    })()`,
  );
  if (!ev.ok || !ev.value?.ok) {
    return { ok: false, error: ev.value?.error ?? ev.error ?? "元素未找到。" };
  }

  try {
    await wc.debugger.sendCommand("Input.insertText", { text: String(text) });
    return { ok: true, selector, length: String(text).length, guestId: wc.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "输入失败。",
    };
  }
}

async function listGuestPages() {
  const pages = [];
  for (const [id] of guests.entries()) {
    const wc = guestFromId(id);
    if (!wc || wc.isDestroyed()) continue;
    let url = null;
    let title = null;
    try {
      url = typeof wc.getURL === "function" ? wc.getURL() : null;
      const titleEv = await evaluateJson(wc, "document.title || ''");
      if (titleEv.ok && typeof titleEv.value === "string") {
        title = titleEv.value;
      }
    } catch {
      /* guest may be loading */
    }
    pages.push({
      guestId: id,
      active: id === activeGuestId,
      url,
      title,
    });
  }
  return { ok: true, pages, activeGuestId };
}

async function activateGuest(guestId) {
  const id = Number(guestId);
  if (!Number.isFinite(id) || !guestFromId(id)) {
    return { ok: false, error: "WebView guest 不存在。" };
  }
  activeGuestId = id;
  return { ok: true, guestId: activeGuestId };
}

async function waitForTracingComplete(state, timeoutMs = TRACE_COMPLETE_WAIT_MS) {
  if (!state?.tracingActive) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const onComplete = () => {
      clearTimeout(timer);
      resolve(true);
    };
    if (!state.traceCompleteResolvers) state.traceCompleteResolvers = [];
    state.traceCompleteResolvers.push(onComplete);
    if (!state.tracingActive) {
      clearTimeout(timer);
      resolve(true);
    }
  });
}

async function readPagePerformanceTiming(wc) {
  const out = await evaluateJson(
    wc,
    `(function() {
      var nav = performance.getEntriesByType("navigation")[0];
      var paint = performance.getEntriesByType("paint");
      var fp = paint.find(function(p) { return p.name === "first-paint"; });
      var fcp = paint.find(function(p) { return p.name === "first-contentful-paint"; });
      var lcp = null;
      try {
        var lcpEntries = performance.getEntriesByType("largest-contentful-paint");
        if (lcpEntries && lcpEntries.length) {
          lcp = lcpEntries[lcpEntries.length - 1].startTime;
        }
      } catch (e) {}
      return {
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        loadEventEnd: nav ? nav.loadEventEnd : null,
        transferSize: nav ? nav.transferSize : null,
        encodedBodySize: nav ? nav.encodedBodySize : null,
        firstPaint: fp ? fp.startTime : null,
        firstContentfulPaint: fcp ? fcp.startTime : null,
        lcp: lcp,
      };
    })()`,
  );
  return out.ok ? out.value : null;
}

async function startPerformanceTrace(guestId, options = {}) {
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) {
    return { ok: false, error: "WebView 未就绪。请打开右栏浏览器并加载页面。" };
  }
  await attachBrowserGuest(wc);
  const state = guestState(wc.id);
  if (!state) {
    return { ok: false, error: "Guest 状态未初始化。" };
  }
  if (state.tracingActive) {
    return {
      ok: false,
      error: "性能 trace 已在进行中。请先 devtools.performance_stop_trace。",
    };
  }

  state.traceChunks = [];
  state.tracingActive = true;

  try {
    await wc.debugger.sendCommand("Tracing.start", {
      transferMode: "ReturnAsStream",
      streamCompression: "none",
      traceConfig: {
        recordMode: "recordUntilFull",
        includedCategories: PERF_TRACE_CATEGORIES,
      },
    });

    if (options.reload) {
      await wc.debugger.sendCommand("Page.reload", { ignoreCache: true });
    }

    return { ok: true, guestId: wc.id, tracing: true, reload: Boolean(options.reload) };
  } catch (error) {
    state.tracingActive = false;
    state.traceChunks = [];
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tracing.start 失败。",
    };
  }
}

async function stopPerformanceTrace(guestId) {
  const id = resolveGuestId(guestId);
  const wc = id != null ? guestFromId(id) : null;
  if (!wc) {
    return { ok: false, error: "WebView 未就绪。请打开右栏浏览器并加载页面。" };
  }
  await attachBrowserGuest(wc);
  const state = guestState(wc.id);
  if (!state) {
    return { ok: false, error: "Guest 状态未初始化。" };
  }

  const hadTrace =
    state.tracingActive || (state.traceChunks?.length ?? 0) > 0;
  if (!hadTrace) {
    return { ok: false, error: "没有进行中的性能 trace。请先 performance_start_trace。" };
  }

  try {
    if (state.tracingActive) {
      await wc.debugger.sendCommand("Tracing.end");
      await waitForTracingComplete(state);
    }
  } catch (error) {
    state.tracingActive = false;
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tracing.end 失败。",
    };
  }

  const chunks = state.traceChunks ?? [];
  state.traceChunks = [];
  state.tracingActive = false;

  let metrics = [];
  try {
    await wc.debugger.sendCommand("Performance.enable");
    const payload = await wc.debugger.sendCommand("Performance.getMetrics");
    metrics = Array.isArray(payload?.metrics) ? payload.metrics : [];
  } catch {
    /* Performance domain optional */
  }

  const pageTiming = await readPagePerformanceTiming(wc);

  let traceFile = null;
  let traceBytes = 0;
  let traceTruncated = false;
  const MAX_TRACE_BYTES = 8_000_000;

  if (chunks.length > 0) {
    const traceJson = JSON.stringify(chunks);
    traceBytes = Buffer.byteLength(traceJson, "utf8");
    if (traceBytes <= MAX_TRACE_BYTES) {
      const dir = path.join(process.cwd(), ".agent-state", "performance-traces");
      await fs.mkdir(dir, { recursive: true });
      traceFile = path.join(dir, `trace-${Date.now()}.json`);
      await fs.writeFile(traceFile, traceJson, "utf8");
    } else {
      traceTruncated = true;
    }
  }

  return {
    ok: true,
    guestId: wc.id,
    eventCount: chunks.length,
    traceBytes,
    traceFile,
    traceTruncated,
    metrics,
    pageTiming,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleBridgeRequest(req, res) {
  try {
    const url = req.url ?? "/";
    const guestIdFromQuery = url.includes("guestId=")
      ? Number(new URL(url, "http://127.0.0.1").searchParams.get("guestId"))
      : undefined;

    if (req.method === "GET" && url.startsWith("/pages")) {
      const out = await listGuestPages();
      jsonResponse(res, 200, out);
      return;
    }

    if (req.method === "GET" && url.startsWith("/health")) {
      jsonResponse(res, 200, {
        ok: true,
        activeGuestId,
        guestCount: guests.size,
      });
      return;
    }

    if (req.method === "GET" && url.startsWith("/guest")) {
      const id = resolveGuestId(guestIdFromQuery);
      jsonResponse(res, 200, { ok: id != null, guestId: id });
      return;
    }

    if (req.method === "GET" && url.startsWith("/console")) {
      const id = resolveGuestId(guestIdFromQuery);
      const state = id != null ? guestState(id) : null;
      jsonResponse(res, 200, {
        ok: id != null,
        guestId: id,
        console: state?.console ?? [],
        exceptions: state?.exceptions ?? [],
      });
      return;
    }

    if (req.method === "GET" && url.startsWith("/network")) {
      const id = resolveGuestId(guestIdFromQuery);
      const state = id != null ? guestState(id) : null;
      jsonResponse(res, 200, {
        ok: id != null,
        guestId: id,
        entries: state?.network ?? [],
        requests: state
          ? Array.from(state.requests.values()).slice(-MAX_NETWORK)
          : [],
      });
      return;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 404, { ok: false, error: "Not found" });
      return;
    }

    const body = await readBody(req);

    if (url.startsWith("/activate")) {
      const out = await activateGuest(body.guestId ?? guestIdFromQuery);
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/send")) {
      const out = await sendCdp(body.guestId ?? guestIdFromQuery, body.method, body.params);
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/click")) {
      const out = await clickSelector(
        body.guestId ?? guestIdFromQuery,
        body.selector,
      );
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/type")) {
      const out = await typeSelector(
        body.guestId ?? guestIdFromQuery,
        body.selector,
        body.text,
      );
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/screenshot")) {
      const useCaptureWindow =
        body.useCaptureWindow === true ||
        body.mode === "captureWindow" ||
        body.captureWindow === true;

      if (useCaptureWindow) {
        const targetUrl =
          typeof body.url === "string" && body.url.trim()
            ? body.url.trim()
            : getGuestUrl(body.guestId ?? guestIdFromQuery);
        if (!targetUrl) {
          jsonResponse(res, 400, {
            ok: false,
            error:
              "隐藏窗口截图需要 url，或先在右栏浏览器打开目标页面。",
          });
          return;
        }
        const shotMode =
          body.shotMode === "fullPage" ||
          body.shotMode === "designArtboard" ||
          body.shotMode === "viewport"
            ? body.shotMode
            : /js\.design|figma\.com|mastergo\.com/i.test(targetUrl)
              ? "designArtboard"
              : "viewport";
        const out = await captureUrlInHiddenWindow(targetUrl, {
          viewportWidth: Number(body.viewportWidth) || 1920,
          viewportHeight: Number(body.viewportHeight) || 1080,
          quality: Number(body.quality) || 72,
          mode: shotMode,
          waitMs: Number(body.waitMs) || 25_000,
        });
        if (!out.ok) {
          jsonResponse(res, 400, out);
          return;
        }
        jsonResponse(res, 200, {
          ok: true,
          jpegBase64: out.jpegBase64,
          captureWindow: true,
          mode: out.mode,
          url: out.url,
          viewportWidth: out.viewportWidth,
          viewportHeight: out.viewportHeight,
          clip: out.clip ?? null,
        });
        return;
      }

      const out = await captureGuestScreenshot(
        body.guestId ?? guestIdFromQuery,
        { fullPage: body.fullPage !== false },
      );
      if (!out.ok) {
        jsonResponse(res, 400, out);
        return;
      }
      jsonResponse(res, 200, {
        ok: true,
        jpegBase64: out.jpegBase64,
        guestId: out.guestId,
        fullPage: out.fullPage,
        captureWindow: false,
      });
      return;
    }

    if (url.startsWith("/dom-snapshot")) {
      const out = await sendCdp(body.guestId ?? guestIdFromQuery, "DOMSnapshot.captureSnapshot", {
        computedStyles: [
          "display",
          "color",
          "background-color",
          "font-size",
          "font-family",
          "border-radius",
          "padding",
          "margin",
        ],
        includeDOMRects: true,
        includePaintOrder: true,
      });
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/ax-tree")) {
      const out = await sendCdp(
        body.guestId ?? guestIdFromQuery,
        "Accessibility.getFullAXTree",
        {},
      );
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/inspect-at")) {
      const x = Number(body.x);
      const y = Number(body.y);
      const out = await sendCdp(body.guestId ?? guestIdFromQuery, "DOM.getNodeForLocation", {
        x,
        y,
      });
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/performance/start")) {
      const out = await startPerformanceTrace(body.guestId ?? guestIdFromQuery, {
        reload: body.reload === true,
      });
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    if (url.startsWith("/performance/stop")) {
      const out = await stopPerformanceTrace(body.guestId ?? guestIdFromQuery);
      jsonResponse(res, out.ok ? 200 : 400, out);
      return;
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    jsonResponse(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Bridge error",
    });
  }
}

function startCdpBridgeServer() {
  if (bridgeServer) return;

  bridgeServer = http.createServer((req, res) => {
    void handleBridgeRequest(req, res);
  });

  bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", () => {
    const baseUrl = `http://127.0.0.1:${BRIDGE_PORT}`;
    void writeBridgeState(baseUrl);
  });
}

export function setupBrowserCdp(getMainWindow = () => null) {
  startCdpBridgeServer();

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      // 延迟 CDP attach：用户浏览时由 capture 按需挂载，减少站点反自动化拦截
      if (!guests.has(contents.id)) {
        guests.set(contents.id, {
          attached: false,
          network: [],
          requests: new Map(),
          console: [],
          exceptions: [],
          tracingActive: false,
          traceChunks: [],
          traceCompleteResolvers: [],
        });
      }
      activeGuestId = contents.id;
      contents.setWindowOpenHandler(({ url }) => {
        if (
          typeof url === "string" &&
          (url.startsWith("http://") || url.startsWith("https://"))
        ) {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send("browser:guest-open-url", url);
          }
        }
        return { action: "deny" };
      });
    }
  });

  ipcMain.handle("browser-cdp:bridge-url", async () => ({
    ok: true,
    baseUrl: `http://127.0.0.1:${BRIDGE_PORT}`,
    port: BRIDGE_PORT,
  }));

  ipcMain.handle("browser-cdp:register", async (_event, guestId) => {
    const wc = guestFromId(guestId);
    if (!wc) return { ok: false, error: "WebView 未就绪。" };
    const ok = await attachBrowserGuest(wc);
    if (ok) activeGuestId = wc.id;
    return ok ? { ok: true, guestId: wc.id } : { ok: false, error: "CDP 挂载失败。" };
  });

  ipcMain.handle("browser-cdp:send", async (_event, guestId, method, params) =>
    sendCdp(guestId, method, params),
  );

  ipcMain.handle("browser-cdp:click", async (_event, guestId, selector) =>
    clickSelector(guestId, selector),
  );

  ipcMain.handle("browser-cdp:type", async (_event, guestId, selector, text) =>
    typeSelector(guestId, selector, text),
  );

  ipcMain.handle("browser-cdp:screenshot", async (_event, guestId) => {
    const out = await captureGuestScreenshot(guestId, { fullPage: true });
    if (!out.ok) return out;
    return {
      ok: true,
      jpegBase64: out.jpegBase64,
      guestId: out.guestId,
      fullPage: out.fullPage,
    };
  });

  ipcMain.handle("browser-cdp:network", async (_event, guestId) => {
    const id = resolveGuestId(guestId);
    const state = id != null ? guestState(id) : null;
    return { ok: id != null, guestId: id, entries: state?.network ?? [] };
  });

  ipcMain.handle("browser-cdp:activate", async (_event, guestId) =>
    activateGuest(guestId),
  );

  ipcMain.handle("browser-cdp:pages", async () => listGuestPages());

  ipcMain.handle("browser-cdp:console", async (_event, guestId) => {
    const id = resolveGuestId(guestId);
    const state = id != null ? guestState(id) : null;
    return {
      ok: id != null,
      guestId: id,
      console: state?.console ?? [],
      exceptions: state?.exceptions ?? [],
    };
  });
}

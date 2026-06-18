/**
 * Codex 级内置浏览器 CDP：附着 <webview> guest，提供 IPC + 本地 HTTP 桥供 Agent 调用。
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, webContents } from "electron";

const BRIDGE_PORT = Number(process.env.VEC_CDP_BRIDGE_PORT ?? 19229);
const MAX_CONSOLE = 80;
const MAX_NETWORK = 200;

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
      network: [],
      /** @type {Map<string, Record<string, unknown>>} */
      requests: new Map(),
      console: [],
      exceptions: [],
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
      }
    });

    return true;
  } catch {
    guests.delete(contents.id);
    return false;
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
      const out = await sendCdp(
        body.guestId ?? guestIdFromQuery,
        "Page.captureScreenshot",
        { format: "jpeg", quality: 72, fromSurface: true },
      );
      if (!out.ok) {
        jsonResponse(res, 400, out);
        return;
      }
      const data = out.result?.data;
      jsonResponse(res, 200, {
        ok: true,
        jpegBase64: typeof data === "string" ? data : null,
        guestId: out.guestId,
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

export function setupBrowserCdp() {
  startCdpBridgeServer();

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      void attachBrowserGuest(contents);
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
    const out = await sendCdp(guestId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 72,
      fromSurface: true,
    });
    if (!out.ok) return out;
    const data = out.result?.data;
    if (!data || typeof data !== "string") {
      return { ok: false, error: "截图为空。" };
    }
    return { ok: true, jpegBase64: data, guestId: out.guestId };
  });

  ipcMain.handle("browser-cdp:network", async (_event, guestId) => {
    const id = resolveGuestId(guestId);
    const state = id != null ? guestState(id) : null;
    return { ok: id != null, guestId: id, entries: state?.network ?? [] };
  });

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

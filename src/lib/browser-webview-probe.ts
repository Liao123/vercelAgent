/** 桌面 WebView 注入脚本：页面错误缓冲 + 轻量 DOM 大纲（A025 CDP-lite）。 */

export const BROWSER_PROBE_INJECT = `(function(){
  if (window.__vecBrowserProbe) return;
  window.__vecBrowserProbe = { errors: [], network: [] };
  window.addEventListener("error", function(e) {
    var msg = e.message || "error";
    if (e.filename) msg += " @ " + e.filename + ":" + (e.lineno || 0);
    window.__vecBrowserProbe.errors.push(msg);
  });
  window.addEventListener("unhandledrejection", function(e) {
    window.__vecBrowserProbe.errors.push("Unhandled rejection: " + String(e.reason));
  });
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      var req = args[0];
      var url = String(req && req.url ? req.url : req);
      var method = String(
        (req && req.method) ||
        (args[1] && args[1].method) ||
        "GET"
      ).toUpperCase();
      var start = Date.now();
      return origFetch.apply(this, args).then(function(res) {
        window.__vecBrowserProbe.network.push({
          url: url,
          method: method,
          kind: "fetch",
          status: res.status,
          durationMs: Date.now() - start,
          ok: res.ok,
          error: res.ok ? null : "HTTP " + res.status
        });
        return res;
      }).catch(function(err) {
        window.__vecBrowserProbe.network.push({
          url: url,
          method: method,
          kind: "fetch",
          status: null,
          durationMs: Date.now() - start,
          ok: false,
          error: String(err)
        });
        throw err;
      });
    };
  }
  if (typeof XMLHttpRequest !== "undefined") {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__vecMethod = method;
      this.__vecUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var xhr = this;
      var start = Date.now();
      xhr.addEventListener("loadend", function() {
        window.__vecBrowserProbe.network.push({
          url: String(xhr.__vecUrl || ""),
          method: String(xhr.__vecMethod || "GET").toUpperCase(),
          kind: "xhr",
          status: xhr.status || null,
          durationMs: Date.now() - start,
          ok: xhr.status >= 200 && xhr.status < 400,
          error: xhr.status >= 400 ? "HTTP " + xhr.status : null
        });
      });
      return origSend.apply(this, arguments);
    };
  }
})();`;

export const BROWSER_HAR_COLLECT_SCRIPT = `(function(){
  var out = [];
  var probe = (window.__vecBrowserProbe && window.__vecBrowserProbe.network) || [];
  for (var i = 0; i < probe.length && out.length < 60; i++) {
    out.push(probe[i]);
  }
  var entries = performance.getEntriesByType("resource") || [];
  for (var j = Math.max(0, entries.length - 80); j < entries.length && out.length < 120; j++) {
    var e = entries[j];
    out.push({
      url: e.name,
      kind: "resource",
      method: "GET",
      initiatorType: e.initiatorType || null,
      status: e.responseStatus || null,
      durationMs: Math.round(e.duration || 0),
      size: e.transferSize || 0,
      timing: {
        dnsMs: Math.max(0, Math.round((e.domainLookupEnd || 0) - (e.domainLookupStart || 0))),
        connectMs: Math.max(0, Math.round((e.connectEnd || 0) - (e.connectStart || 0))),
        ttfbMs: Math.max(0, Math.round((e.responseStart || 0) - (e.requestStart || 0)))
      }
    });
  }
  return out;
})()`;

/** @deprecated use BROWSER_HAR_COLLECT_SCRIPT */
export const BROWSER_NETWORK_RESOURCES_SCRIPT = BROWSER_HAR_COLLECT_SCRIPT;

export const BROWSER_PROBE_READ_NETWORK = `(function(){
  return (window.__vecBrowserProbe && window.__vecBrowserProbe.network) || [];
})()`;

export function buildBrowserQueryScript(selector: string, maxResults: number): string {
  const safeSelector = JSON.stringify(selector);
  const max = Math.min(Math.max(maxResults, 1), 40);
  return `(function(){
  var nodes = document.querySelectorAll(${safeSelector});
  var out = [];
  for (var i = 0; i < nodes.length && out.length < ${max}; i++) {
    var el = nodes[i];
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    out.push({
      tag: el.tagName ? el.tagName.toLowerCase() : "?",
      id: el.id || null,
      className: typeof el.className === "string" ? el.className.slice(0, 120) : null,
      text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 120),
      rect: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      } : null
    });
  }
  return out;
})()`;
}

export const BROWSER_DOM_OUTLINE_SCRIPT = `(function(){
  var items = [];
  var sel = "a,button,input,select,textarea,[role=button],[role=link],h1,h2,h3,label";
  var nodes = document.querySelectorAll(sel);
  for (var i = 0; i < nodes.length && items.length < 48; i++) {
    var el = nodes[i];
    var tag = el.tagName ? el.tagName.toLowerCase() : "?";
    var text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "").trim();
    if (text.length > 72) text = text.slice(0, 72) + "…";
    var id = el.id ? "#" + el.id : "";
    items.push(tag + id + (text ? ": " + text : ""));
  }
  return items.join("\\n");
})()`;

export const BROWSER_PROBE_READ_ERRORS = `(function(){
  return (window.__vecBrowserProbe && window.__vecBrowserProbe.errors) || [];
})()`;

export type BrowserConsoleLevel = "debug" | "info" | "warning" | "error";

export function mapWebviewConsoleLevel(level: number): BrowserConsoleLevel {
  if (level >= 3) return "error";
  if (level === 2) return "warning";
  if (level === 1) return "info";
  return "debug";
}

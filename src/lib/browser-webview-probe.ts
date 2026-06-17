/** 桌面 WebView 注入脚本：页面错误缓冲 + 轻量 DOM 大纲（A025 CDP-lite）。 */

export const BROWSER_PROBE_INJECT = `(function(){
  if (window.__vecBrowserProbe) return;
  window.__vecBrowserProbe = { errors: [] };
  window.addEventListener("error", function(e) {
    var msg = e.message || "error";
    if (e.filename) msg += " @ " + e.filename + ":" + (e.lineno || 0);
    window.__vecBrowserProbe.errors.push(msg);
  });
  window.addEventListener("unhandledrejection", function(e) {
    window.__vecBrowserProbe.errors.push("Unhandled rejection: " + String(e.reason));
  });
})();`;

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

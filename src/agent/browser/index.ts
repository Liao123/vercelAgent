/**
 * 浏览器能力统一出口。
 *
 * 当前是 Web 原型里的 URL 打开状态；后续桌面端会在同一边界后面接 WebView/CDP。
 */
export * from "@/agent/browser/browser-state";
export * from "@/agent/browser/browser-snapshot";
export * from "@/agent/browser/browser-query";
export * from "@/agent/browser/browser-har";
export * from "@/agent/browser/browser-cdp-guest";

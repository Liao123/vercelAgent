/**
 * Electron WebView 加载错误码（Chromium net error）。
 * 跳转中上一请求被中止时不应视为失败。
 */
export const WEBVIEW_LOAD_ABORTED = -3;

export function isIgnorableWebviewLoadError(errorCode?: number): boolean {
  return errorCode === WEBVIEW_LOAD_ABORTED;
}

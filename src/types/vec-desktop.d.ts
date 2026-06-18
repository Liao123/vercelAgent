export type VecDesktopBridge = {
  isDesktop: boolean;
  platform: string;
  pickWorkspaceFolder: () => Promise<string | null>;
  openConfigDirectory: (
    targetDir?: string,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  onWorkspaceFolderFromMenu: (
    callback: (folderPath: string) => void,
  ) => () => void;
  /** 注册内置浏览器 WebView guest，挂载 CDP（Codex 路线）。 */
  registerBrowserGuest: (
    guestWebContentsId: number,
  ) => Promise<{ ok: boolean; guestId?: number; error?: string }>;
  captureBrowserScreenshot: (
    guestWebContentsId: number,
  ) => Promise<{ ok: boolean; jpegBase64?: string; error?: string }>;
  getBrowserNetworkLog: (
    guestWebContentsId: number,
  ) => Promise<{ ok: boolean; entries?: unknown[] }>;
  getBrowserConsoleLog: (
    guestWebContentsId: number,
  ) => Promise<{
    ok: boolean;
    console?: unknown[];
    exceptions?: unknown[];
  }>;
  sendBrowserCdp: (
    guestWebContentsId: number,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  clickBrowserSelector: (
    guestWebContentsId: number,
    selector: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  typeBrowserSelector: (
    guestWebContentsId: number,
    selector: string,
    text: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getCdpBridgeUrl: () => Promise<{
    ok: boolean;
    baseUrl?: string;
    port?: number;
  }>;
};

declare global {
  interface Window {
    vecDesktop?: VecDesktopBridge;
  }
}

export {};

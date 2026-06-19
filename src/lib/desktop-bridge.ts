/** Electron 桌面壳注入的 `window.vecDesktop` 桥接。 */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.vecDesktop?.isDesktop);
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  if (!isDesktopApp() || !window.vecDesktop?.pickWorkspaceFolder) {
    return null;
  }
  try {
    return await window.vecDesktop.pickWorkspaceFolder();
  } catch {
    return null;
  }
}

export async function openDesktopConfigDirectory(
  targetDir?: string,
): Promise<boolean> {
  if (!isDesktopApp() || !window.vecDesktop?.openConfigDirectory) {
    return false;
  }
  try {
    const result = await window.vecDesktop.openConfigDirectory(targetDir);
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export function subscribeWorkspaceFolderFromMenu(
  onFolder: (folderPath: string) => void,
): () => void {
  if (!isDesktopApp() || !window.vecDesktop?.onWorkspaceFolderFromMenu) {
    return () => {};
  }
  return window.vecDesktop.onWorkspaceFolderFromMenu(onFolder);
}

export async function registerBrowserGuest(
  guestWebContentsId: number,
): Promise<boolean> {
  if (!isDesktopApp() || !window.vecDesktop?.registerBrowserGuest) {
    return false;
  }
  try {
    const result = await window.vecDesktop.registerBrowserGuest(
      guestWebContentsId,
    );
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export async function captureBrowserScreenshotCdp(
  guestWebContentsId: number,
): Promise<string | null> {
  if (!isDesktopApp() || !window.vecDesktop?.captureBrowserScreenshot) {
    return null;
  }
  try {
    const result = await window.vecDesktop.captureBrowserScreenshot(
      guestWebContentsId,
    );
    return result?.ok && result.jpegBase64 ? result.jpegBase64 : null;
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isDesktopApp() || !window.vecDesktop?.openExternalUrl) {
    return false;
  }
  try {
    const result = await window.vecDesktop.openExternalUrl(url);
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export function subscribeBrowserGuestOpenUrl(
  onUrl: (url: string) => void,
): () => void {
  if (!isDesktopApp() || !window.vecDesktop?.onBrowserGuestOpenUrl) {
    return () => {};
  }
  return window.vecDesktop.onBrowserGuestOpenUrl(onUrl);
}

export async function fetchBrowserNetworkCdp(
  guestWebContentsId: number,
): Promise<unknown[]> {
  if (!isDesktopApp() || !window.vecDesktop?.getBrowserNetworkLog) {
    return [];
  }
  try {
    const result = await window.vecDesktop.getBrowserNetworkLog(
      guestWebContentsId,
    );
    return result?.ok && Array.isArray(result.entries) ? result.entries : [];
  } catch {
    return [];
  }
}

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

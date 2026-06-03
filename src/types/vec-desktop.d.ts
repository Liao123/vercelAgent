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
};

declare global {
  interface Window {
    vecDesktop?: VecDesktopBridge;
  }
}

export {};

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vecDesktop", {
  isDesktop: true,
  platform: process.platform,
  pickWorkspaceFolder: () => ipcRenderer.invoke("workspace:pick-folder"),
  openConfigDirectory: (targetDir) =>
    ipcRenderer.invoke("desktop:open-config-dir", targetDir),
  onWorkspaceFolderFromMenu: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, folderPath) => {
      if (typeof folderPath === "string" && folderPath.length > 0) {
        callback(folderPath);
      }
    };
    ipcRenderer.on("workspace:folder-from-menu", handler);
    return () => {
      ipcRenderer.removeListener("workspace:folder-from-menu", handler);
    };
  },
});

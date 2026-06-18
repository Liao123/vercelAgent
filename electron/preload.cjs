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
  registerBrowserGuest: (guestWebContentsId) =>
    ipcRenderer.invoke("browser-cdp:register", guestWebContentsId),
  captureBrowserScreenshot: (guestWebContentsId) =>
    ipcRenderer.invoke("browser-cdp:screenshot", guestWebContentsId),
  getBrowserNetworkLog: (guestWebContentsId) =>
    ipcRenderer.invoke("browser-cdp:network", guestWebContentsId),
  getBrowserConsoleLog: (guestWebContentsId) =>
    ipcRenderer.invoke("browser-cdp:console", guestWebContentsId),
  sendBrowserCdp: (guestWebContentsId, method, params) =>
    ipcRenderer.invoke("browser-cdp:send", guestWebContentsId, method, params),
  clickBrowserSelector: (guestWebContentsId, selector) =>
    ipcRenderer.invoke("browser-cdp:click", guestWebContentsId, selector),
  typeBrowserSelector: (guestWebContentsId, selector, text) =>
    ipcRenderer.invoke("browser-cdp:type", guestWebContentsId, selector, text),
  getCdpBridgeUrl: () => ipcRenderer.invoke("browser-cdp:bridge-url"),
});

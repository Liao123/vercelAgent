import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startStandaloneServer,
  stopStandaloneServer,
  waitForServer,
} from "./server-launcher.mjs";
import { setupBrowserCdp } from "./browser-cdp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_WAIT_MS = Number(process.env.VEC_SERVER_WAIT_MS ?? 120_000);
const isPackaged = app.isPackaged;

let mainWindow = null;
let serverChild = null;
/** 打包版 Next standalone 目录（.env.local 所在） */
let packagedConfigDir = null;
let appBaseUrl =
  process.env.VEC_DESKTOP_URL?.trim() || "http://localhost:3000";

async function resolveBaseUrl() {
  if (!isPackaged) {
    return appBaseUrl;
  }

  const standaloneDir = path.join(process.resourcesPath, "standalone");
  packagedConfigDir = standaloneDir;
  const started = await startStandaloneServer(standaloneDir);
  serverChild = started.child;
  return started.baseUrl;
}

async function pickWorkspaceFolder() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ["openDirectory"],
    title: "选择项目文件夹",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

function sendFolderToRenderer(folderPath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("workspace:folder-from-menu", folderPath);
}

function buildMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "打开项目文件夹…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const folderPath = await pickWorkspaceFolder();
            if (folderPath) sendFolderToRenderer(folderPath);
          },
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "在浏览器中打开",
          click: () => {
            void shell.openExternal(appBaseUrl);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "vec Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      /** webview 标签需关闭 sandbox（Electron 限制） */
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.loadURL(appBaseUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  setupBrowserCdp(() => mainWindow);
  ipcMain.handle("desktop:open-external-url", async (_event, url) => {
    if (typeof url !== "string" || !url.trim()) {
      return { ok: false, error: "url is required." };
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Only http(s) URLs are allowed." };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "打开链接失败。",
      };
    }
  });
  ipcMain.handle("workspace:pick-folder", pickWorkspaceFolder);
  ipcMain.handle("desktop:open-config-dir", async (_event, targetDir) => {
    const dir =
      typeof targetDir === "string" && targetDir.trim().length > 0
        ? targetDir.trim()
        : packagedConfigDir;
    if (!dir) {
      return { ok: false, error: "配置目录不可用（仅打包版或需传入路径）。" };
    }
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true, path: dir };
  });
  buildMenu();

  try {
    appBaseUrl = await resolveBaseUrl();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "无法启动内置 Agent 服务。";
    await dialog.showMessageBox({
      type: "error",
      message: "vec Agent 启动失败",
      detail: isPackaged
        ? `${detail}\n\n请重新安装或联系维护者。开发模式请单独运行 npm run dev。`
        : `${detail}\n\n请先运行 npm run dev，或设置 VEC_DESKTOP_URL。`,
    });
    app.quit();
    return;
  }

  if (!isPackaged) {
    const ready = await waitForServer(appBaseUrl, SERVER_WAIT_MS);
    if (!ready) {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        message: "未检测到 Agent 服务",
        detail: `请先在项目根目录运行 npm run dev，并确认 ${appBaseUrl} 可访问。\n\n仍要打开空白窗口吗？`,
        buttons: ["退出", "仍要打开"],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 0) {
        app.quit();
        return;
      }
    }
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopStandaloneServer(serverChild);
  serverChild = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

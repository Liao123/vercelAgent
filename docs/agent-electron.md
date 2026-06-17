# Electron 桌面端（A025）

更新时间：2026-06-03

桌面壳 **不承载** Agent 核心逻辑，负责窗口、文件夹选择器，以及（打包后）**内置 Next 服务**。

## 开发模式（双终端或一键）

```bash
npm install
npm run dev          # 终端 A
npm run electron     # 终端 B

# 或：
npm run dev:desktop
```

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VEC_DESKTOP_URL` | `http://127.0.0.1:3000` | 开发时桌面壳加载地址 |
| `VEC_SERVER_WAIT_MS` | `120000` | 开发模式等待 API |

## 打包安装（推荐试用）

```bash
# 1) 构建 standalone + 复制 static/public
npm run build:desktop

# 2a) 免安装目录（便于调试）
npm run pack:desktop:dir
# 输出：dist-desktop/win-unpacked/vec Agent.exe

# 2b) Windows 便携包（脚本已默认关闭代码签名探测）
npm run pack:desktop
# 输出：dist-desktop/vec Agent-0.1.0-win-x64.exe

# 调试目录（已成功验证）：
# dist-desktop/win-unpacked/vec Agent.exe
```

打包版启动时会：

1. 用 `ELECTRON_RUN_AS_NODE` 在 `resources/standalone` 内启动 `server.js`
2. 自动分配本机端口并打开窗口
3. 退出应用时结束子进程

**模型 API**：打包时若项目根有 `.env.local` 会复制进 `resources/standalone`；否则会随包附带 `.env.example`。首次打开桌面版时顶部 **首次设置** 条可：

- **生成 .env.local 模板**（从 `.env.example`）
- **打开配置目录**（资源管理器定位 standalone）
- **选择项目文件夹…**

填好 Key 后点 **配置后重新加载**。

用户向说明见 [desktop-quickstart.md](./desktop-quickstart.md)。

## Web UI

- Electron 内左栏：**选择文件夹…**（`window.vecDesktop`）
- 浏览器仍用手填 workspace 路径

## 开发者闭环

- `http://localhost:3000/?dev=1`（或 `localStorage vec-agent-dev=1`）→ 顶部可折叠 **develop** 面板（`/api/agent/develop`）
- 默认主界面 **不显示** develop；主路径仍是 Agent Loop

```bash
npm run validate:agent-dev-mode
```

## 内置浏览器（A023 MVP）

- 桌面壳：`webviewTag` + `BrowserWebview`（`src/components/browser-webview.tsx`）
- 页面 `dom-ready` 后 POST `/api/agent/browser/snapshot`（标题 + 正文摘要 + **console / DOM 大纲 / 页面错误**）
- Agent 工具：`browser.open` → 加载预览；`browser.inspect` → 读取最近快照（含 CDP-lite 字段）

```bash
npm run validate:browser-desktop
npm run validate:browser-cdp-lite
```

Web 版仍用 iframe；部分站点禁止嵌入，请用桌面版或新标签打开。

## 验证

```bash
npm run validate:electron-shell
npm run validate:electron-pack
npm run validate:browser-desktop
npm run validate:desktop-setup
npm run validate:workspace-tree-paths
npm run validate:cursor-shell-ui
npm run trial:server-check
npm run trial:server-check:run
```

## 后续

- 代码签名 / 自动更新
- CDP 深度（network HAR、截图、元素 query）——console/DOM/页面错误已 MVP（`validate:browser-cdp-lite`）

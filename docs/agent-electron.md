# Electron 桌面端（A025）

更新时间：2026-06-03

桌面壳 **不承载** Agent 核心逻辑，负责窗口、文件夹选择器，以及（打包后）**内置 Next 服务**。

## 开发模式（双终端或一键）

```bash
npm install
npm run dev          # 终端 A
npm run electron     # 终端 B（若未跑 dev，Windows 会自动新开「vec-next dev」终端）

# 或同终端一键：
npm run dev:desktop
```

`npm run electron` 会先检测 `VEC_DESKTOP_URL`；服务未就绪时 **Windows 会弹出新的 CMD 窗口**（标题 `vec-next dev`）跑 `npm run dev`，再打开桌面壳。仅启动 Electron 进程用 `npm run electron:raw`。若不想弹新窗口、要在当前终端看 Next 日志：`VEC_ELECTRON_DEV_SAME_TERMINAL=1 npm run electron`。

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

## 内置浏览器（Codex 路线 · A023 / A129）

- **桌面版 = Codex 同级**：`webviewTag` + Chromium WebView + **CDP**（`electron/browser-cdp.mjs`）
  - `Page.captureScreenshot` 截图
  - `Network.*` 采集（与注入 HAR-lite 合并）
  - Agent：`browser.open` → `browser.inspect` → `browser.query`
- 右栏 Tab 显示 **Codex 模式** 徽章；支持后退 / 前进 / 刷新
- **纯网页**：默认引导 `npm run dev:desktop`；可选 iframe 降级（非 Codex 同级）

```bash
npm run validate:browser-desktop
npm run validate:browser-cdp-lite
```

Web 版默认 **不提供** Codex 同级能力，仅可选 iframe 降级；**Codex 式内置浏览器请用桌面版**。

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

### 代码签名（生产发布前）

Windows 默认 `pack:desktop` 关闭签名探测（`CSC_IDENTITY_AUTO_DISCOVERY=false`），本地可打包便携版。正式发布时：

```powershell
# Windows Authenticode（示例）
$env:CSC_LINK = "path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "..."
# 移除 pack-desktop.mjs 中的 CSC_IDENTITY_AUTO_DISCOVERY=false 或设为 true
npm run pack:desktop
```

macOS 需 Apple Developer 证书 + notarization；`electron-builder.yml` 中 `mac.identity` / `mac.notarize` 按需配置。

### 自动更新（未接入）

`electron-builder.yml` 预留 `publish` 配置位；需 GitHub Releases / S3 等 provider + `electron-updater` 主进程 hook。当前 **未实现** in-app 检查更新。

### 浏览器 CDP（A130）

- **HTTP 桥**：`http://127.0.0.1:19229`（`VEC_CDP_BRIDGE_PORT`）；`.agent-state/cdp-bridge.json`
- **Guest**：WebView 注册 → `.agent-state/browser-cdp-guest.json`
- **Agent**：`devtools.*`（DOM 快照、AX、console、network、click、type、box model、computed style、坐标探测）
- **HAR-lite** 仍保留；性能 trace、多标签、Lighthouse 仍 deferred

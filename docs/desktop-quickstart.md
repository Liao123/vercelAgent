# 桌面版快速上手

给第一次使用 `vec Agent` 桌面应用的同学。

## 1. 获取程序

开发机打包（需已安装 Node.js）：

```bash
npm install
npm run pack:desktop:dir
```

免安装目录：`dist-desktop/win-unpacked/vec Agent.exe`

便携单文件（可选）：

```bash
npm run pack:desktop
```

输出：`dist-desktop/vec Agent-0.1.0-win-x64.exe`

## 2. 首次启动：配置模型 API

1. 打开 `vec Agent.exe`
2. 若顶部出现 **「首次使用 · 配置模型 API」**：
   - 点 **生成 .env.local**（若无此按钮则已存在配置文件）
   - 点 **打开配置目录**，用记事本编辑 `.env.local`
   - 填入 `OPENAI_API_BASE`、`OPENAI_API_KEY`、`OPENAI_MODEL`（参见包内 `.env.example`）
   - 保存后点 **重新加载**
3. 横幅消失即表示 API 已识别

## 3. 选项目并开始

1. 左下角 **项目名 ▾** → **打开文件夹…**，选择你的代码仓库
2. 左侧 **新建 Agent** 或项目行 **＋** 开新会话
3. 底部输入任务，**Enter** 发送
4. 有文件变更时：
   - 右侧 **审查** Tab 看 diff（点文件名切换）
   - **双击** 审查列表中的文件可在 **文件** Tab 定位
   - 中栏变更卡片 **应用更改** / **拒绝**
5. shell/git 类命令在中栏底部 **命令审批条** 批准

## 4. 开发调试

```bash
npm run dev:desktop
```

浏览器对照：`http://localhost:3000`（需手填 workspace 路径）

开发者闭环（非主路径）：`http://localhost:3000/?dev=1`

## 5. 自检命令

```bash
npm run trial:server-check
npm run trial:golden-path-ui
npm run validate:desktop-setup
```

详见 [agent-electron.md](./agent-electron.md)。

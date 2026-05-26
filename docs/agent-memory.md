# 开发智能体本地记忆

更新时间：2026-05-27

本文档用于记录项目长期事实、架构决策、用户偏好和后续开发注意事项。它不是聊天记录，也不是密钥存储。

## 使用规则

1. 只记录对后续开发有长期价值的信息。
2. 不记录 API Key、token、账号密码、私有 Cookie。
3. 架构决策必须写清楚原因。
4. 当项目方向变化时，更新对应条目，不要让旧决策误导后续 AI。
5. 每次完成重要工作项后，必要时同步更新本文档。

## 项目事实

- 当前项目路径：`D:\workspace\vercelAgent`
- 当前项目是 Next.js + React + TypeScript 应用。
- 当前 Next.js 版本：16.2.6。
- 当前 React 版本：19.2.4。
- 当前项目还不是 monorepo。
- 当前目标不是普通聊天应用，而是逐步演进成开发智能体。
- 当前已有架构规划文档：`docs/agent-architecture.md`。
- 当前已有进度文档：`docs/agent-progress.md`。

## 用户目标

用户想做一个类似 Codex 的开发智能体，核心能力包括：

- 选择项目后理解项目结构。
- 用户用中文描述需求，智能体能定位页面、模块和文件。
- 智能体能修改代码并验证结果。
- 支持内置浏览器。
- 当前阶段只要求内置浏览器能打开指定网址，AI 能触发打开即可。
- Chrome DevTools 深度读取网页结构、元素宽高、样式、截图、console、network 暂缓。
- demo 网站解析成结构化数据并生成页面代码暂缓。
- 后期可能做 Electron，但不是当前第一优先级。

## 已确认架构决策

### D001：短期不大改项目结构

决策：

当前继续保持 Next.js 单体项目结构，先在 `src/agent` 中引入智能体核心骨架。

原因：

过早迁移 monorepo 会增加复杂度。当前更重要的是跑通主链路。

### D002：Agent Runtime 不写死在 UI 中

决策：

智能体核心逻辑必须独立于 React 组件，后续可以迁移到本地 agent-server。

原因：

未来需要同时支持 Web UI、Electron UI，甚至 IDE 客户端。UI 应该只是客户端。

### D003：浏览器能力以 Chrome DevTools 为主线

决策：

长期浏览器和网页解析能力以 Chrome DevTools 为主线，不把 Playwright 放在主链路。当前阶段只做内置浏览器打开 URL，不做元素读取、样式读取和 design spec。

原因：

用户已经用 Chrome DevTools 提示词跑通了网页读取能力，但现在希望先收窄工作项。浏览器当前只作为可打开页面的内嵌能力，深度读取后续再做。

### D004：需要上下文管理和压缩

决策：

项目必须实现上下文管理、上下文压缩和 token 预算管理。

原因：

开发智能体会产生大量对话、工具调用、代码片段、浏览器快照和日志。不能把所有历史无脑塞给模型。

### D005：可以参考 openai/codex，但不照搬

决策：

`openai/codex` 是重要参考，重点参考 App Server、JSON-RPC、thread/turn/events、approval、sandbox、patch/diff、project instructions、skills 和 trace。

原因：

Codex CLI 是 Apache-2.0 开源项目，有成熟架构价值。但它主要是 Rust/CLI，本项目是 TypeScript/Next.js/Web/Electron 方向，不应整仓库照搬。

## 用户偏好

- 用户希望先规划清楚再干。
- 用户希望文档严谨，后续 AI 能按文档继续推进。
- 用户不希望一开始大改项目结构。
- 用户倾向中文沟通。
- 用户已经有一套 Chrome DevTools 提示词跑通网页读取流程，后续应复用。
- 用户希望每完成一个工作项都更新进度文档。

## 后续注意事项

- 修改 Next.js 相关代码前，必须按 `AGENTS.md` 要求阅读 `node_modules/next/dist/docs/` 中相关文档。
- 不要把 Codex CLI 下载到当前业务项目里。
- 如需研究 `openai/codex`，应放到独立参考目录，例如 `D:\workspace\_reference\codex`。
- 不要把密钥或敏感配置写入文档。
- 文档里的工作项状态要及时更新。
- 每次实现新模块前，先确认它对应 `docs/agent-progress.md` 中哪个工作项。
- 当前阶段不要展开 Chrome DevTools 的元素读取、样式读取、network、console 和 design spec。

## 待补充信息

- 用户已经跑通的 Chrome DevTools 提示词内容。
- 当前模型接口最终要支持哪些供应商。
- 本地工作区选择方式：网页配置路径、Electron 文件选择器，还是本地 agent-server 配置。
- 是否需要先支持单项目，还是早期就支持多 workspace。

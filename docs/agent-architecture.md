# 开发智能体项目架构规划 V2

更新时间：2026-06-01

本文档用于指导后续 AI 或开发者继续实现本项目。当前目标不是做一个普通聊天页面，而是逐步做成一个 Codex-like 的本地开发智能体：能理解项目、读取规则、定位代码、修改文件、运行验证、操作内置浏览器，并把长任务过程可靠地记录下来。

## 1. 参考对象

本规划参考 Codex 公开架构，但不会照搬实现。

主要参考：

- Codex App Server 架构文章：<https://openai.com/index/unlocking-the-codex-harness/>
- Codex agent loop 文章：<https://openai.com/index/unrolling-the-codex-agent-loop/>
- Codex CLI 仓库：<https://github.com/openai/codex>
- Codex CLI App Server 文档：<https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- Codex CLI 入门文档：<https://help.openai.com/en/articles/11096431>

从公开资料可以确认的关键点：

- Codex CLI 是开源的本地命令行 coding agent，仓库是 `openai/codex`，许可证是 Apache-2.0。
- Codex App Server 是一个面向客户端的双向 JSON-RPC API。
- Codex 的多个客户端形态，包括 CLI、IDE、桌面端等，核心都围绕同一套 agent harness / app-server 思路展开。
- Codex 的核心不是 UI，而是 agent loop、工具系统、权限审批、沙箱、上下文管理、事件流和 trace。

结论：

`openai/codex` 很有参考价值。后续实现本项目时应该参考它的架构边界、协议设计、审批模式、沙箱思想、app-server 事件模型和工具组织方式。但不要直接照搬它的 Rust 实现，也不要把项目目标变成复刻 Codex CLI。本项目的差异点是：你需要网页/桌面 UI、内置浏览器、Chrome DevTools 页面读取、设计网站解析和中文需求到业务代码定位。

## 2. 当前项目状态

当前仓库是一个 Next.js 网页应用，主要能力是通过 API 路由转发模型请求，并提供基础聊天界面。

当前技术栈：

- Next.js 16.2.6
- React 19.2.4
- TypeScript
- Tailwind CSS 4
- OpenAI 兼容接口 / DeepSeek 接口

当前关键文件：

- `src/app/page.tsx`、`src/components/agent-workspace.tsx`：Agent 工作区 UI（三栏）
- `src/components/agent-turn-block.tsx`、`agent-turn-reasoning-timeline.tsx`：中栏 Turn 与逐步推理时间线
- `src/components/agent-right-rail.tsx`：右栏内置浏览器（推理已迁至中栏）
- `src/app/api/agent/*`：Agent API（loop、审批、工具等）
- `src/agent/model/chat-completions-provider.ts`：OpenAI 兼容模型调用（非聊天页面）

重要约束：

- 仓库根目录 `AGENTS.md` 明确说明：当前 Next.js 版本存在破坏性变化。写 Next.js 相关代码前，必须阅读 `node_modules/next/dist/docs/` 中的相关官方文档。
- 短期不要大改项目结构。先在当前结构中引入 agent 骨架，等能力变复杂后再迁移 monorepo。

## 3. 产品目标

最终产品是一个面向开发工作的智能体，核心能力包括：

1. 选择本地项目，并识别项目结构、技术栈、路由、页面、组件、接口和业务模块。
2. 读取项目规则，例如 `AGENTS.md`、README、框架配置、用户自定义规则。
3. 用户用中文描述需求后，智能体能定位相关文件，制定计划，修改代码，并运行验证。
4. 提供内置浏览器，用户可以在产品里打开 demo 网站、本地页面或目标网址。
5. 通过 Chrome DevTools 读取页面结构、元素宽高、坐标、样式、截图、console、network 和交互结果。
6. 把 demo 网站解析成结构化 `design spec JSON`，再生成或修改项目代码。
7. 维护 Thread、Task、Turn、上下文摘要和 trace，让长任务可以继续、恢复和审计。
8. 对高风险操作进行权限控制，例如写文件、删文件、安装依赖、执行命令、Git 操作。
9. 修改后展示 diff、运行验证、收集错误，并把最终结果清楚反馈给用户。

非目标：

- 短期不做完整 IDE 替代。
- 短期不做复杂多 agent 并行。
- 短期不做云端分布式执行。
- 短期不做插件市场。
- 短期不把核心逻辑绑定在 Electron UI 中。

## 4. 总体架构

推荐架构：

```text
Web UI / Electron UI / IDE Client
        |
        | JSON-RPC / WebSocket / HTTP
        v
Local Agent Runtime / App Server
        |
        +-- Agent Core
        +-- Model Provider
        +-- Tool Runtime
        +-- Workspace Manager
        +-- Code Indexer
        +-- Memory Manager
        +-- Browser Runtime
        +-- Chrome DevTools Adapter
        +-- Verification Runner
        +-- Trace Store
```

UI 负责：

- 选择工作区
- 输入需求
- 展示计划
- 展示工具调用
- 展示 diff
- 展示浏览器
- 展示截图和日志
- 展示审批请求
- 中断、继续、重试任务

Agent Runtime 负责：

- 管理 Thread / Task / Turn
- 编排 agent loop
- 构建模型上下文
- 调用模型
- 调用工具
- 读写文件
- 执行命令
- 调用 Chrome DevTools
- 做上下文压缩
- 记录 trace
- 运行验证

原则：

- UI 是客户端，不是智能体核心。
- Agent Runtime 应该能脱离 Next.js 独立运行。
- 后续 Electron 只是产品壳，不是重写核心逻辑。

## 5. 核心概念

### 5.1 Workspace

Workspace 是一个本地项目根目录。

需要记录：

- workspace id
- 根路径
- Git 根路径
- 当前分支
- package manager
- 框架信息
- 项目规则文件
- 可信任状态
- 权限策略

### 5.2 Thread

Thread 是一条长期会话，类似 Codex 中可恢复的开发上下文。

需要记录：

- thread id
- workspace id
- 标题
- 创建时间
- 最近活动时间
- 当前状态
- 历史任务
- 压缩后的会话摘要
- 用户偏好和项目记忆引用

Thread 用于让用户后续继续同一个开发主题。

### 5.3 Task

Task 是一次具体开发任务。

示例：

- “给用户管理页面增加状态筛选”
- “根据这个 demo 网站生成首页”
- “修复 build 报错”

需要记录：

- task id
- thread id
- 原始用户需求
- 当前状态
- 计划
- 事件流
- 读取文件列表
- 修改文件列表
- 验证结果
- 最终总结

状态建议：

```text
created
planning
waiting_for_approval
running
verifying
completed
failed
cancelled
```

### 5.4 Turn

Turn 是用户和 agent 的一次交互回合。

Thread 可以包含多个 Turn，一个 Task 也可以跨多个 Turn 继续。

Turn 需要记录：

- 用户输入
- 模型输出
- 工具调用
- 工具结果
- 是否触发上下文压缩
- 本轮摘要

### 5.5 AgentEvent

UI 不应该只等待一个最终字符串，而应该持续接收事件。

事件类型建议：

```ts
type AgentEvent =
  | { type: "thread.created"; threadId: string }
  | { type: "task.created"; taskId: string }
  | { type: "plan.updated"; taskId: string; plan: AgentPlan }
  | { type: "model.delta"; taskId: string; text: string }
  | { type: "tool.started"; taskId: string; toolName: string; args: unknown }
  | { type: "tool.completed"; taskId: string; toolName: string; result: unknown }
  | { type: "approval.required"; taskId: string; approval: ApprovalRequest }
  | { type: "file.changed"; taskId: string; filePath: string; diff: string }
  | { type: "browser.screenshot"; taskId: string; imagePath: string }
  | { type: "verification.completed"; taskId: string; result: VerificationResult }
  | { type: "reflection.updated"; taskId: string; reflection: AgentReflection; at?: string }
  | { type: "context.compacted"; taskId: string; summaryId: string }
  | { type: "task.completed"; taskId: string; summary: string }
  | { type: "task.failed"; taskId: string; error: string };
```

### 5.6 Trace

Trace 是调试智能体的生命线。

必须记录：

- 用户原始输入
- 模型请求摘要
- 模型响应摘要
- 工具调用参数
- 工具调用结果
- 读取了哪些文件
- 修改了哪些文件
- 执行了哪些命令
- 浏览器访问了哪些 URL
- Chrome DevTools 提取了哪些页面信息
- 验证结果
- 最终 diff
- 错误和重试原因

Trace 不一定全部展示给用户，但必须可查询。

## 6. 推荐目录结构

短期保持当前 Next.js 结构，只新增 agent 相关目录。

短期结构：

```text
src/
  agent/
    core/
    model/
    tools/
    workspace/
    memory/
    indexer/
    browser/
    protocol/
    trace/
  app/
  components/
  lib/
docs/
  agent-architecture.md
```

中长期迁移为 monorepo：

```text
apps/
  web/
    # 当前 Next.js 网页 UI
  desktop/
    # 后期 Electron + React + Vite 桌面端
  agent-server/
    # 本地 Agent 服务，暴露 JSON-RPC / WebSocket / HTTP API

packages/
  agent-core/
  model-provider/
  tools/
  workspace/
  browser-runtime/
  chrome-devtools/
  code-indexer/
  memory/
  protocol/
  trace-store/
  verification/
  shared/
```

迁移原则：

- 当前不要为了架构好看而大搬目录。
- 先把主链路跑通。
- 当 `src/agent` 变大，再拆到 `packages/*`。

## 7. Model Provider

模型层必须可替换，不要让业务逻辑依赖某个厂商的原始 API。

建议接口：

```ts
interface ModelProvider {
  generate(input: ModelInput): Promise<ModelOutput>;
  stream(input: ModelInput): AsyncIterable<ModelEvent>;
  embed?(input: EmbedInput): Promise<EmbedOutput>;
  compact?(input: CompactInput): Promise<CompactOutput>;
}
```

职责：

- 统一 OpenAI 兼容接口、DeepSeek、Claude、本地模型等调用方式
- 处理流式输出
- 处理工具调用 schema
- 处理错误和重试
- 统计 token 使用量
- 支持上下文压缩或摘要模型

禁止：

- 在 React 组件中直接拼模型消息
- 在工具函数里直接调用具体模型
- 把模型名称散落在多个业务文件中

## 8. Agent Core

Agent Core 是任务执行中心。

基本循环：

```text
接收用户需求
  -> 创建或恢复 Thread
  -> 创建 Task / Turn
  -> 读取 workspace 和项目规则
  -> 检索相关文件和项目记忆
  -> 构建模型上下文
  -> 制定计划
  -> 调用工具
  -> 观察工具结果
  -> 必要时继续推理
  -> 修改代码
  -> 运行验证
  -> 记录 trace
  -> 输出总结
```

Agent Core 必须支持：

- 计划更新
- 中断任务
- 继续任务
- 等待用户审批
- 工具失败后恢复
- 上下文超限前压缩
- 任务完成后写入摘要

## 9. Tool Runtime

工具层必须受控，不允许模型直接任意执行系统命令。

基础工具：

```text
workspace.select
workspace.scan
project.read_rules
file.list
file.read
file.search
file.write_patch
file.create
file.delete
git.status
git.diff
git.branch
git.commit
shell.run
package.detect
test.run
formatter.run
browser.open
browser.inspect
browser.screenshot
devtools.snapshot
devtools.inspect_element
devtools.extract_design_spec
```

权限分级：

```text
低风险：读取文件、搜索、读取 Git 状态、读取浏览器页面信息
中风险：修改文件、创建文件、运行项目内 lint/build/test
高风险：删除文件、安装依赖、执行任意 shell、修改环境变量、git push
```

原则：

- 文件修改优先 patch。
- 修改前必须读取当前文件内容。
- 修改后必须展示 diff。
- 删除文件必须确认。
- 安装依赖必须确认。
- 任意 shell 命令必须确认或走白名单。
- 所有工具调用都必须写入 trace。

## 10. 权限和沙箱

Codex 的一个关键点是审批模式和沙箱边界。本项目也必须有这层，否则本地开发智能体很容易失控。

最低要求：

- 每个任务绑定 workspace 根目录。
- 文件读写限制在 workspace 内。
- 禁止路径穿越。
- 写 `.env*` 必须确认。
- 删除文件必须确认。
- 安装依赖必须确认。
- Git push 必须确认。
- 任意 shell 命令默认需要确认。
- 网络访问策略需要配置。
- 浏览器读取外部网址时要记录 URL。

审批模式建议：

```text
Suggest：只读，写文件和执行命令都要用户确认。
Auto Edit：允许自动写文件，但执行命令仍需确认。
Full Auto：允许在受限 workspace 内自动写文件和运行白名单命令。
```

注意：

Full Auto 必须有明确边界。短期即使没有完整 OS sandbox，也至少要做 workspace path 限制、命令白名单和高风险操作拦截。

## 11. 上下文管理和压缩

开发智能体必须有上下文管理，不然长任务必炸。这里不是锦上添花，是核心能力。

上下文分层：

```text
System Context：系统指令、工具说明、安全规则
Project Context：AGENTS.md、README、框架信息、项目索引
Thread Memory：长期对话摘要、用户偏好、历史决策
Task Memory：当前任务目标、计划、已读文件、已改文件、验证结果
Turn Context：最近用户输入、最近模型输出、最近工具结果
Retrieved Context：本轮检索到的相关代码片段
```

每次请求模型前，必须做 token 预算：

```text
模型最大上下文
  - 系统指令
  - 工具 schema
  - 项目规则
  - 当前任务需求
  - 当前计划
  - 最近对话
  - 相关代码片段
  - 关键工具结果
  - 预留输出 token
```

压缩策略：

- 系统指令永远保留。
- 项目规则摘要保留，原文按需读取。
- 当前用户需求原文保留。
- 当前任务计划保留。
- 已修改文件列表保留。
- 测试和构建错误保留关键片段。
- 大段 shell 输出压缩为摘要。
- 旧工具结果压缩为事实摘要。
- 大文件不常驻上下文，按需读取。
- Chrome DevTools 原始大 JSON 不直接塞给模型，要先结构化提取。

触发压缩的时机：

- token 预算超过阈值。
- 工具结果过大。
- 一个 Task 跨多个 Turn。
- Thread 即将恢复前。
- 验证日志过长。

压缩产物：

```ts
interface ContextSummary {
  id: string;
  scope: "thread" | "task" | "turn" | "tool";
  sourceIds: string[];
  summary: string;
  facts: string[];
  openQuestions: string[];
  changedFiles: string[];
  createdAt: string;
}
```

## 12. Prompt Cache 友好策略

如果模型供应商支持 prompt caching，应让稳定内容保持稳定。

建议：

- 系统指令顺序稳定。
- 工具 schema 顺序稳定。
- 项目规则摘要位置稳定。
- 不要在系统 prompt 中插入每轮变化的大块内容。
- 动态内容放在用户/任务上下文区域。
- 大日志和页面快照先压缩再进入上下文。

这不是第一阶段必须完成，但架构上要预留。

## 13. Code Indexer

Code Indexer 的目标是让用户可以用中文描述页面或模块，智能体能定位到相关代码。

需要索引：

```text
文件路径
文件类型
导入关系
导出符号
React/Vue 组件名
路由路径
页面标题和关键文本
API 调用
后端接口
状态管理
表单字段
表格列
业务关键词
文件摘要
最近更新时间
```

推荐技术：

- `ripgrep`：快速搜索
- TypeScript Language Service：TS/JS 符号和引用分析
- `ts-morph`：TypeScript AST 分析
- `tree-sitter`：多语言语法树
- SQLite：本地结构化索引
- 向量库：本地语义检索，可选 LanceDB / Chroma / SQLite vector extension

原则：

不要只依赖向量库。开发智能体需要：

```text
结构化索引 + 关键词搜索 + AST 关系 + 语义检索
```

索引输出示例：

```json
{
  "filePath": "src/app/users/page.tsx",
  "kind": "page",
  "route": "/users",
  "components": ["UserTable", "UserFilter"],
  "apiCalls": ["/api/users"],
  "businessKeywords": ["用户管理", "状态筛选", "用户列表"],
  "summary": "用户管理页面，包含搜索表单、状态筛选、用户表格和分页。"
}
```

## 14. 内置浏览器和 Chrome DevTools

这里必须按你的已跑通方案走：Chrome DevTools 是主线，不把 Playwright 放在主链路。

分三层：

```text
内置浏览器 UI
  -> 用户能打开网址、查看页面、点击、输入

Chrome DevTools 工具层
  -> AI 能读取 DOM、样式、尺寸、截图、console、network

设计解析流程
  -> 把页面事实整理成 design spec JSON，再交给代码生成流程
```

内置浏览器能力：

- 打开 URL
- 显示当前页面
- 支持用户点击和输入
- 支持本地 dev server 页面
- 支持 demo 网站
- 记录当前 URL
- 支持截图展示

Chrome DevTools 能力：

```text
devtools.get_dom_snapshot
devtools.get_accessibility_tree
devtools.get_screenshot
devtools.inspect_element_at
devtools.get_box_model
devtools.get_computed_style
devtools.get_console_errors
devtools.get_network_requests
devtools.click
devtools.type
devtools.extract_design_spec
```

常用 CDP 能力：

```text
Page.captureScreenshot
DOM.getDocument
DOM.querySelector
DOM.getBoxModel
CSS.getComputedStyleForNode
DOMSnapshot.captureSnapshot
Accessibility.getFullAXTree
Runtime.evaluate
Input.dispatchMouseEvent
Network.*
Log.*
Runtime.exceptionThrown
```

设计解析流程：

```text
输入 URL
  -> 打开内置浏览器
  -> 等待页面稳定
  -> 获取截图
  -> 获取 DOM 快照
  -> 获取 accessibility tree
  -> 提取元素 bbox
  -> 提取 computed style
  -> 提取字体、颜色、间距、圆角、阴影
  -> 提取图片资源
  -> 记录关键交互路径
  -> 生成 design spec JSON
```

设计规格示例：

```json
{
  "url": "https://example.com",
  "viewport": { "width": 1440, "height": 900 },
  "colors": ["#111827", "#ffffff", "#2563eb"],
  "typography": [
    { "role": "heading", "fontSize": 48, "fontWeight": 700 }
  ],
  "sections": [
    {
      "name": "hero",
      "bbox": { "x": 0, "y": 0, "width": 1440, "height": 720 },
      "elements": []
    }
  ],
  "assets": [
    { "src": "https://example.com/hero.png", "width": 1200, "height": 800 }
  ]
}
```

注意：

- 模型不要只靠截图猜页面。
- Chrome DevTools 提供事实，模型负责判断和生成。
- 原始页面快照可能很大，需要提取后再进入上下文。
- 你已经跑通的 Chrome DevTools 提示词应该沉淀为固定 skill / prompt 模板。

## 15. Skills 和 Prompt 模板

Codex 有 skills / instructions 的思想。本项目也需要类似机制。

用途：

- 固定某类任务的工作流程
- 固定工具调用顺序
- 固定输出格式
- 降低模型随机发挥
- 让已跑通经验可复用

建议先建立这些 skill：

```text
code-change
  中文需求 -> 定位文件 -> 修改 -> 验证

chrome-devtools-design-extract
  URL -> DevTools 读取 -> design spec JSON

design-to-code
  design spec + 素材 -> 页面代码 -> 浏览器验证

bugfix
  错误日志 -> 定位原因 -> 修改 -> 验证

project-index
  扫描项目 -> 页面/组件/API/关键词索引
```

Skill 文件可以先放：

```text
src/agent/skills/
```

或后期迁移为：

```text
packages/skills/
```

## 16. Verification Runner

智能体写完代码后必须验证。

按项目能力自动选择：

```text
npm run lint
npm run typecheck
npm run test
npm run build
打开本地页面
截图
收集 console error
收集 network failed request
检查白屏
检查关键文本
检查明显布局溢出
```

验证结果必须写入：

- Task 事件流
- Trace
- 最终总结

如果验证失败，Agent 应该继续尝试修复，直到：

- 修复成功
- 达到最大重试次数
- 需要用户补充信息
- 需要用户批准高风险操作

## 17. UI 设计要求

UI 应该是开发工具，不是营销页。

**当前已落地（三栏 Agent Workspace，2026-06）**：

```text
左栏：项目 → 会话树、新会话、继续/命名/删除
中栏：用户气泡 →「已执行 X 秒 / 工作中…」推理总折叠 → 最终回答 → 变更条
      （展开总折叠：多轮 理解/打算/工具链 + 技术日志）
      底栏：任务输入 + Loop 模式 + 延续记忆
右栏：变更审查（diff / patch / Git / shell 审批）+ 内置浏览器折叠
```

与 Codex/Cursor 对齐的要点：

- **推理在主对话区**，不在独立「规划侧栏」；`plan.updated` 仍供运行时同步，中栏默认 `excludeEventTypes` 隐藏。
- 每轮 Task 一组 Turn：`task.created` 分界；Worked 类事件进 `narrativeEvents` 或 `detailEvents`。
- `reflection.updated` 提供理解 / 阻塞 / plannedNext；`tool_call` JSON 的 `thought` 写入 `ToolCallRecord.rationale` 展示。
- 完成后推理总折叠自动收起，只留一行摘要 + 最终交付。

必要功能（已实现 / 进行中）：

- 选择项目目录
- 显示当前 Git 分支和 dirty 状态
- 展示 Thread / Task
- 展示 agent 计划
- 展示工具调用流
- 展示文件 diff
- 批准或拒绝高风险操作
- 展示内置浏览器
- 展示 DevTools 提取结果
- 展示浏览器截图
- 展示验证结果
- 支持中断任务
- 支持继续任务
- 支持重试某一步

## 18. Electron 规划

Electron 是产品形态，不是智能体核心。

什么时候做 Electron：

- 本地 Agent Runtime 已经跑通
- 文件读写和权限审批已经跑通
- 内置浏览器和 Chrome DevTools 需要更自然的桌面集成
- 用户体验需要本地应用承载

Electron 职责：

- 本地窗口
- 系统文件选择器
- 管理本地 agent-server 生命周期
- 和本地服务通信
- 承载内置浏览器
- 管理本地权限确认
- 打包、自动更新、日志目录

Electron 不应承担：

- Agent Core 主逻辑
- 模型调用主逻辑
- 代码索引主逻辑
- 上下文压缩主逻辑
- 工具执行主逻辑

## 19. 协议设计

UI 和 Agent Runtime 建议通过 JSON-RPC 或 WebSocket 通信。Codex App Server 的公开文档可以作为重点参考。

最低 API：

```text
thread.start
thread.resume
thread.list
thread.cancel
task.start
task.continue
task.cancel
approval.resolve
workspace.select
workspace.scan
browser.open
browser.inspect
```

事件流必须支持：

- 任务状态变化
- 模型增量输出
- 工具开始和完成
- 审批请求
- 文件变更
- 浏览器截图
- 上下文压缩
- 验证结果

## 20. MVP 实现顺序

> **进度对照表（2026-06-01）** — 与 `docs/agent-progress.md` 工作项 A001–A080 对齐；准确度专项见 [`agent-accuracy-roadmap.md`](agent-accuracy-roadmap.md)。

| 阶段 | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 任务化聊天 | **已完成** | Thread/Task/Turn/AgentEvent、ModelProvider、任务流 UI；旧通用聊天页已移除，由 Agent Workspace 取代（A005–A007、A037+）。 |
| 2 | 本地工作区与基础工具 | **已完成** | Workspace、规则读取、文件/Git 只读工具、Trace 雏形与 JSON 持久化（A009–A012、A026–A027）。 |
| 3 | 受控修改和审批 | **已完成** | Patch、文件 mutation、Git/shell 写操作、审批+执行闭环、diff 审查 UI（A013–A015、A029–A041、A043–A048）。 |
| 4 | 上下文管理和压缩 | **已完成** | 分层 Memory、Token Budget、Loop 压缩+pinned facts、Thread 滚动记忆（A015–A017、A051–A053、A058–A059、A068）。 |
| 5 | 代码索引和中文定位 | **部分完成** | 轻量索引 + 中文定位 + UI import 树（A018–A019、A072）；**进行中** A073–A078 准确度（layout 上下文、prepare 门禁、jsx 引用）；**未做** SQLite、向量检索。 |
| 6 | 开发闭环 | **部分完成** | `/api/agent/develop` 固定流水线已跑通（A021），**日常主路径为 Agent Loop**（A028）；develop 不再投入（D018）；自动修复验证错误仍弱。 |
| 7 | 内置浏览器与 DevTools | **部分完成** | iframe 浏览器 + `browser.open` 已可用（A022）；**未做** CDP 深度读取、DOM/样式/截图/console/network（A023 deferred）。 |
| 8 | 设计解析与页面生成 | **暂缓** | demo → design spec → 代码生成主链路未启动（A024 deferred）。 |
| 9 | Electron 桌面端 | **暂缓** | 主链路 Web 版已可用；系统目录选择器、WebView/CDP 集成留待立项（A025 deferred）。 |

**当前产品焦点（阶段 1–4 + Loop 主链路）**：

```text
选 workspace → Loop 任务 → 中栏推理时间线 → 工具取证 → 准备审批
  → 右栏审查 diff → 用户批准/执行 → Trace + 可选 Thread 记忆延续
```

**图例**：已完成 = 交付物基本齐全；部分完成 = 核心可用但有明确缺口；暂缓 = 已决策不做或下一阶段。

---

### 阶段 1：任务化聊天

**状态：已完成**（工作项 A005–A007、A032+；A071 中栏 Turn/推理 UI）

目标：

- 保留当前聊天能力
- 增加 Thread / Task / Turn 类型
- 增加 AgentEvent 事件流
- 增加 ModelProvider 抽象

交付物：

- `ModelProvider`
- `Thread`
- `Task`
- `Turn`
- `AgentEvent`
- 任务流 UI 雏形

### 阶段 2：本地工作区和基础工具

**状态：已完成**（A009–A012、A026–A027）

目标：

- 选择 workspace
- 读取项目规则
- 读取文件树
- 搜索文件
- 读取文件
- 查看 git status / diff

交付物：

- Workspace Manager
- 文件工具
- Git 工具
- 项目规则读取
- Trace Store 雏形

### 阶段 3：受控修改和审批

**状态：已完成**（A013–A014、A029–A041、A043–A048）

目标：

- 让 AI 可以通过 patch 修改文件
- 展示 diff
- 写文件、删文件、执行命令有审批

交付物：

- patch 工具
- approval system
- 权限策略
- 文件变更事件

### 阶段 4：上下文管理和压缩

**状态：已完成**（A015–A017、A051–A053、A058–A059、A068）

目标：

- 不再无脑塞完整历史
- 建立上下文预算
- 长任务自动摘要

交付物：

- Memory Manager
- Token Budget
- Context Summary
- 压缩事件

### 阶段 5：代码索引和中文定位

**状态：部分完成** — 缺 SQLite、向量检索（A018–A019 已做轻量版）

目标：

- 扫描项目结构
- 建立页面、组件、API、业务关键词索引
- 支持中文需求定位文件

交付物：

- Code Indexer
- SQLite 索引
- 文件摘要
- 路由映射
- 关键词搜索 + 语义搜索

### 阶段 6：开发闭环

**状态：部分完成** — develop 流水线有（A021），**日常用 Agent Loop**（A028）；不增强 develop（D018）

目标：

- 中文需求 -> 定位文件 -> 计划 -> 修改 -> 验证 -> 总结

交付物：

- Agent Core 主循环
- Verification Runner
- 自动修复验证错误
- 最终 diff 总结

### 阶段 7：内置浏览器和 Chrome DevTools

**状态：部分完成** — 仅打开 URL（A022）；DevTools 深度能力暂缓（A023）

目标：

- 在产品里打开目标网址
- AI 能读取当前页面结构和元素信息
- 沉淀你已跑通的 Chrome DevTools prompt

交付物：

- 内置浏览器 UI
- Chrome DevTools Adapter
- DOM/CSS/Layout 提取
- console/network 收集
- 页面截图

### 阶段 8：设计网站解析和页面生成

**状态：暂缓**（A024 deferred）

目标：

- demo URL + 素材 -> design spec JSON -> 代码生成/修改 -> 浏览器验证

交付物：

- design spec 生成器
- 素材管理
- design-to-code skill
- 浏览器截图验证

### 阶段 9：Electron 桌面端

**状态：暂缓**（A025 deferred；见 agent-memory D026 立项条件）

目标：

- 用 Electron 承载 UI 和本地能力
- 复用已有 Agent Runtime

交付物：

- Electron app
- agent-server 生命周期管理
- 本地权限弹窗
- 打包配置

## 21. openai/codex 参考清单

后续开发需要重点参考 `openai/codex` 的这些方向：

1. `codex-rs/app-server/README.md`

   参考 JSON-RPC 协议、thread、turn、events、approvals、skills、apps 等设计。

2. App Server protocol 类型

   参考它如何定义请求、响应、事件和版本化协议。

3. Approval 模式

   参考 suggest、auto edit、full auto 这类权限层级思想。

4. Sandbox 实现

   参考它如何限制文件系统、网络和命令执行。即使本项目不照搬，也要保留同等概念。

5. Patch / diff 流程

   参考它如何展示修改、等待确认、应用变更和回传结果。

6. Project instructions

   参考它如何读取 `AGENTS.md` 等项目规则。

7. Skills / plugin 机制

   参考它如何把可复用能力变成显式工作流。

8. Trace / event stream

   参考它如何让 UI 客户端持续知道 agent 在做什么。

不建议照搬：

- Rust 工程结构
- CLI/TUI 交互细节
- Codex 专用认证流程
- 具体模型默认值
- 与本项目 UI 无关的功能

## 22. 后续 AI 开发守则

后续 AI 继续开发时必须遵守：

1. 修改 Next.js 相关代码前，先阅读 `node_modules/next/dist/docs/` 中对应功能文档。
2. 不要把 Agent Runtime 逻辑写死在 React 组件中。
3. 新增能力时先定义输入、输出、权限级别和 trace 记录。
4. 文件修改优先 patch，避免整文件覆盖。
5. 对本地文件、命令、Git、依赖安装等操作做权限控制。
6. 大上下文必须通过检索和摘要进入模型，不允许无脑塞完整项目。
7. 浏览器事实由 Chrome DevTools 工具提供，模型只做判断和生成。
8. 页面解析必须生成结构化 design spec，不允许只让模型凭截图猜。
9. 每个开发任务最终都要有验证结果。
10. 保留用户已有改动，不要擅自回滚。
11. 所有新增模块都应能被 trace 记录。
12. 不要过早迁移 monorepo。
13. 不要过早做 Electron。
14. 不要把 openai/codex 当成唯一答案，要结合本项目目标取舍。

## 23. 近期干净任务列表

接下来按这个顺序做：

1. 保持当前 Next.js 项目结构不大改。
2. 新增 `src/agent` 目录骨架。
3. 抽象 `ModelProvider`。
4. 定义 `Thread`、`Task`、`Turn`、`AgentEvent`。
5. 把聊天响应改成任务事件流。
6. 增加 `Trace Store` 雏形。
7. 增加 workspace 概念。
8. 读取 `AGENTS.md` 和项目规则。
9. 增加文件读取、目录扫描、搜索工具。
10. 增加 Git status / diff 工具。
11. 增加 patch 修改工具。
12. 增加审批机制。
13. 增加上下文管理骨架。
14. 增加上下文压缩机制。
15. 增加 token 预算管理。
16. 增加项目索引。
17. 增加中文需求定位文件能力。
18. 增加验证工具。
19. 跑通开发闭环。
20. 增加内置浏览器 UI。
21. 接入 Chrome DevTools。
22. 沉淀 Chrome DevTools prompt 为 skill。
23. 增加页面数据提取。
24. 增加 design spec JSON。
25. 增加 demo 页面生成/复刻流程。
26. 增加浏览器验证。
27. 主链路稳定后再做 Electron。

先把这条主链路跑通：

```text
选择项目
  -> 创建 Thread / Task
  -> 读取项目规则
  -> 建立上下文
  -> 中文需求定位文件
  -> 制定计划
  -> 调工具读/改代码
  -> 展示 diff
  -> 运行验证
  -> 记录 trace
  -> 必要时压缩上下文
```

然后再接设计解析主链路：

```text
内置浏览器
  -> Chrome DevTools 读取页面
  -> design spec JSON
  -> 生成/修改代码
  -> 浏览器验证
```

# 开发智能体本地记忆

更新时间：2026-05-29

本文档用于记录项目长期事实、架构决策、用户偏好和后续开发注意事项。它不是聊天记录，也不是密钥存储。

## 使用规则

1. 只记录对后续开发有长期价值的信息。
2. 不记录 API Key、token、账号密码、私有 Cookie。
3. 架构决策必须写清楚原因。
4. 当项目方向变化时，更新对应条目，不要让旧决策误导后续 AI。
5. 每次完成重要工作项后，必要时同步更新本文档。

## 项目事实

- 当前开发仓库路径：`D:\workspace\vercelAgent`（文档早期曾写 `D:\案例\vec-next`，以实际 workspace 为准）。
- 当前项目是 Next.js + React + TypeScript 应用。
- 当前 Next.js 版本：16.2.6。
- 当前 React 版本：19.2.4。
- 当前项目还不是 monorepo。
- 当前目标不是普通聊天应用，而是逐步演进成开发智能体。
- 当前已有架构规划文档：`docs/agent-architecture.md`。
- 当前已有进度文档：`docs/agent-progress.md`。
- 当前已有 agent 骨架目录：`src/agent`。
- 模型调用统一走 `ModelProvider`（`chat-completions-provider`），不再提供独立 `/api/chat` 聊天路由。
- 当前已有 `/api/agent/workspace` 只读工作区信息接口。
- 当前已有 `/api/agent/tasks` 任务事件流雏形接口。
- 当前已有 `/api/agent/git` 受控 Git 写操作接口。

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

### D013：Agent Loop 上下文压缩策略（A051）

决策：

- Loop 每次模型调用前走 `compactAgentLoopMessages`：固定保留头部（system + 原始 user）与尾部最近 12 条消息；中间段合并为单条 `[COMPACTED_MEMORY]`。
- 超预算时先确定性 `compressContext`，仍过大且 provider 可用时再语义 compact（一次额外模型调用）。
- 工具结果入 messages 前经 `shapeToolResultForObservation` 截断，避免单次 `file.read` 撑爆上下文。
- 环境变量 `AGENT_LOOP_SEMANTIC_COMPACT=false` 可关闭语义层，仅保留确定性压缩。

原因：

对齐 Cursor/Codex Agent 的长任务行为：旧 tool 观测可丢细节但保留路径/错误/审批事实；尾部保留最近推理与工具结果供模型继续。

### D014：滚动任务记忆与 Pinned Facts（A052）

决策：

- 压缩产物为结构化 `[COMPACTED_MEMORY]`：`## Pinned facts` / `## Summary` / `## Changed files`。
- 再次压缩时解析 prior memory，与新一轮 evicted 中间段合并（确定性 + `ModelProvider.compact`），不重复全文塞回模型。
- `approval_*`、路径、分支、错误从 evicted 消息抽取进 Pinned，永不依赖模型“记得”。
- `file.*.prepare` / `patch.prepare` 观测只保留 `approvalId` 等关键字段，避免审批预览重复占 token。

原因：

贴近 Cursor/Codex 的 rolling compaction + pinned context，而不是单次全量摘要。

### D015：Trace 全文记忆 + Thread 跨任务（A053）

决策：

- 每次压缩把完整 `[COMPACTED_MEMORY]` 写入 `context.compacted.memoryContent`（Trace 可复盘）。
- 同步写入 `.agent-state/thread-memory.json`，按 `threadId` 索引。
- 新 Task 传 `threadId` 时：system → 滚动记忆 → 当前 user 请求 → 反思/工具 tail。
- UI 默认勾选「延续会话记忆」；「新会话」清空 threadId。

原因：

对齐 Cursor/Codex 的 session/thread 级记忆，而不是每个 Task 从零开始。

### D018：开发闭环不再投入（2026-05-27 用户确认）

决策：

- 日常开发**只使用 Agent Loop**（`/api/agent/loop`）。
- **开发闭环**（`/api/agent/develop`）为早期无模型流水线：索引 → 规则定位文件 → 仅当 API 传入 patch 时才改文件；**不调用 LLM**，界面自然语言不会自动生成代码。
- UI 保留 Loop/闭环切换与 `AgentRunModeHint` 即可；**不必再增强 develop 路线**。

### 收工快照（2026-05-27，便于明天接续）

**上下文 / 会话相关代码**：

| 模块 | 路径 |
| --- | --- |
| Loop 压缩 | `src/agent/memory/loop-context-compactor.ts`、`loop-pinned-facts.ts` |
| 持久化 | `src/agent/memory/thread-memory-store.ts`、`thread-meta-store.ts`、`agent-thread-index.ts` |
| Loop 接入 | `src/agent/core/agent-loop.ts`（每轮 generate 前 compact；`threadId` 注入记忆） |
| API | `/api/agent/loop`、`/api/agent/threads`（GET/PATCH/DELETE）、`/api/agent/thread-memory` |
| UI | `agent-session-sidebar.tsx`、`agent-compacted-memory-panel.tsx`、`agent-run-mode-hint.tsx` |

**环境变量**：`AGENT_LOOP_SEMANTIC_COMPACT=false` 可关闭语义压缩（仅确定性）。

**2026-05-29 已验证**：`npm run validate:agent`；`golden-path-trial` @ `D:\案例\aiproject`；恢复 Trace 审批/输入框见 D025。

### D016：会话侧栏与记忆摘要索引（A054）

决策：

- 左栏上半「会话」来自 `buildAgentThreadList`（thread-memory + traces 合并）。
- 下半「任务」可按选中会话筛选；点会话 = 设置 `threadId` 并开启延续记忆。
- 列表展示 `summaryPreview`（压缩时写入 thread-memory 与 trace.thread.contextSummary）。

原因：

用户需要像 Cursor 一样选历史会话继续，而不是只在任务粒度翻 Trace。

### D017：会话重命名 / 删记忆 / 一键继续（A055，侧栏 UI A063 补全）

决策：

- 自定义标题存 `thread-meta.json`，列表优先展示 `customTitle`。
- `DELETE /api/agent/threads?threadId=&workspaceId=` 清滚动记忆 + `thread-meta.hidden`；Trace 保留。
- 侧栏悬停：**继续**（预填 `lastUserRequest`）、**命名**、**删除**。
- **点击会话行**只恢复活动流，不预填输入（见 D025）。

原因：

对齐 Cursor 会话管理：可改名、可从侧栏移除会话、可一键接着聊。

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
- A004-A021 已完成，下一步从 A022 浏览器打开能力占位开始。
- 当前 `npm run build` 通过。
- 当前 `npm run lint` 已通过。
- 当前 `npm run build` 仍有一个 Turbopack NFT tracing 警告，来源是 Next route 里引入 workspace 文件系统读取。当前不影响构建，后续拆出本地 agent-server 时处理。
- 当前 patch 工具支持 unified diff 预览和应用，但应用必须使用与 patch hash 匹配的已批准 approval。
- 当前 patch 工具暂不支持新建、删除、重命名、二进制文件和复杂 git patch。
- 当前已有结构化文件变更工具：`src/agent/tools/file-mutations.ts` 和 `/api/agent/files`。
- 结构化文件变更支持 `create`、`write`、`delete`、`rename`；preview 会生成 approval，apply 必须携带匹配且已批准的 `approvalId`。A035 后，前端可以通过审批执行接口从持久化 approval.details 发起 apply。
- 当前已有受控 Git 写操作工具：`src/agent/tools/git-tools.ts` 和 `/api/agent/git`。
- Git 写操作支持 `branch`、`commit`、`push`；preview 会生成 `git.mutate:<hash>` approval，apply 必须携带匹配且已批准的 `approvalId`。A035 后，前端可以通过审批执行接口从持久化 approval.details 发起 apply。
- Agent Loop 当前新增 `git.mutation.prepare`，只允许模型准备 Git 写操作和审批请求，不允许直接执行 branch/commit/push。
- 不要让模型绕过 `/api/agent/git` 直接执行 Git 写操作；branch/commit/push 后续即使进入更强 loop，也必须走审批和 trace。
- Approval Store 当前会写入 `.agent-state/approvals.json`；不要只依赖内存 Map，Next route/runtime 实例之间内存不可靠。
- Agent Loop 当前新增 `file.mutation.prepare`，只允许模型准备文件变更和审批请求，不允许直接 apply。
- 新建/删除/重命名文件优先走 `/api/agent/files`；旧 patch 工具继续负责 unified diff 修改已有文件，后续再统一升级更完整 patch parser。
- 当前已有 `src/agent/memory` 上下文管理骨架，可生成 system、project_rules、thread_memory、task_memory、turn_context、retrieved_context、tool_result 分层上下文。
- 当前已有确定性上下文压缩骨架，可将多段 `ContextSection` 压缩成结构化 `ContextSummary`，并在任务事件中发出 `context.compacted`。
- 当前压缩机制还不是模型级语义 compact，后续可接 ModelProvider 做更高质量摘要。
- 当前已有 token 预算管理，默认最大输入 32000，预留输出 4000，并按 ContextSection 优先级筛选上下文。
- 当前已有轻量项目索引器，可识别 page、layout、api_route、component、agent、script、config、doc、source、asset 等文件类型，并提取 route、imports、exports、API methods、业务关键词和摘要。
- 当前项目索引还没有 SQLite 持久化、AST 精确分析和向量检索。
- 当前已有中文需求定位文件能力，可基于项目索引输出候选文件、分数和命中原因。
- 当前文件定位还是规则/关键词版，没有 embedding、AST 引用图和历史任务记忆加权。
- 当前已有验证工具，只允许运行 package.json 中存在的白名单 npm scripts：lint、build、test、typecheck。
- 当前项目有 lint/build 脚本，暂无 test/typecheck 脚本。
- 当前已有最小开发闭环 `/api/agent/develop`，可串起需求、项目索引、文件定位、可选 patch 预览/应用、验证和总结。
- 当前开发闭环还不会让模型自动生成 patch；修改文件需要调用方显式传入 patch，且 apply 时必须提供匹配 approval。
- 当前已有模型驱动 Agent Loop：`src/agent/core/agent-loop.ts`、`src/agent/core/agent-loop-tools.ts` 和 `/api/agent/loop`。
- Agent Loop 协议：模型每轮必须返回 JSON，形如 `{"action":"tool_call","tool":"...","args":{}}` 或 `{"action":"final","summary":"..."}`。
- 当前 Agent Loop 开放工具：workspace.inspect、project.index、file.locate、file.list、file.read、file.search、git.status、git.diff、browser.open、file.replace.prepare、file.mutation.prepare、git.mutation.prepare。
- 当前 Agent Loop 不开放直接写文件、shell、Git 写操作、安装依赖；文件和 Git 的 prepare 工具只创建 approval，不执行 apply。真正 apply 仍需要用户在审批 UI 中先批准、再点击执行。
- AgentPanel 仍有 `开发闭环` / `Agent Loop` 切换；**默认 Loop**。用户 2026-05-27 确认不必再投入闭环；见 D018。
- AgentPanel 当前已有审批 UI：自动读取 `/api/agent/approvals`，展示 approval 列表，并支持批准/拒绝 pending approval。
- 当前审批 UI 已能展示 A034 的结构化审批详情：文件变更会显示操作类型、路径、大小变化和截断 before/after；Git 写操作会显示操作类型、目标参数、预览命令和风险 notes。
- 当前审批 UI 已接入 A035 执行闭环：`批准` 和 `执行` 是两个动作，approved 且未成功执行的 approval 才显示 `执行`，执行结果会持久化并在刷新后继续展示。
- A036 已修复一个真实可用性问题：用户在页面说“把首页鹊桥去掉”时，旧默认开发闭环只定位/总结，不会真正生成改动。现在默认走 Agent Loop，并新增 `file.replace.prepare` 精确文本替换工具。
- A036 兜底能力：对“首页 + 去掉/删除/移除某段文本”的请求，运行时会稳定准备 `src/app/page.tsx` 写入 approval；这只生成审批，不自动写文件。
- 当前首页布局（A050）：左栏项目+任务历史 → **中栏**（上：活动流+涉及文件+内联待授权，**下：固定输入框**）→ **右栏**任务规划步骤+运行状态+内置浏览器显示/隐藏。不再在 Agent 首页挂载通用 `Chat` 组件。
- 已移除旧版通用聊天 UI（`chat.tsx`、`/api/chat`、`/api/images`、文生图链路）。识图仅用于 Agent：`referenceImages` + `readImageFile`。
- Agent Loop 附图：`buildAgentUserContent` + `/api/agent/loop` 的 `referenceImages`；最多 4 张。开发闭环暂不接图。
- 活动流由 `src/components/agent-event-timeline.tsx` 渲染为可读卡片；`layout=default` 时仍保留 JSON 分组调试视图。
- 当前已有 Web 阶段内置浏览器占位：`src/agent/browser`、`/api/agent/browser` 和 `BrowserPanel`。它在 Agent Workspace 底部辅助面板中打开。
- 当前浏览器目标状态会落到 `.agent-state/browser.json`，不要只依赖模块级内存；Next.js 不同 route/runtime 实例之间的内存状态不可靠。
- 当前 `/api/agent/develop` 会识别用户需求中的第一个 URL，并发出 `browser.open` 工具事件，作为 AI 触发打开 URL 的最小链路。
- Web 内置浏览器只是原型壳，会受 iframe 嵌入限制；后续 Electron/本地客户端阶段需要把它替换成 WebView/Chrome DevTools 能力。
- 已补充后续 backlog：Trace Store 持久化、Workspace 项目选择、真正 Agent Loop、完整文件修改能力、Git 写操作、多层项目规则合并、前端 UI 接 Agent 事件流。
- A037/A038 已完成：UI 更接近 Codex/Cursor Agent 单工作区；patch preview 审批也写入 `details` 并可通过 `/api/agent/approvals/execute` 执行。
- A039 已完成：审批详情使用 `DiffView` 行级 +/- 高亮；活动流支持类型筛选与「调试 JSON」；Git commit/push 有高风险提示横幅。
- A040 已完成：Git 审批 preview 含 `workspace` 快照（status、diff、branch、push 的 remoteUrl）。
- A041 已完成：Shell 仅白名单 `npm run lint|build|test|typecheck`，走 `shell.command.prepare` 与 execute 闭环；Push 在 UI 需二次确认。
- A042 已完成：Agent Workspace「历史」面板可浏览 `.agent-traces/`（`/api/agent/traces` + `TracePanel`）。
- A043 已完成：unified diff 支持新建/删除/重命名（`---`/`+++` 含 `/dev/null`），与 file mutation 互补。
- A044 已完成：`DiffView` 默认 split 左右对照（可切统一 diff）；活动流合并工具起止事件、支持折叠与结果摘要。
- A045 已完成：Agent Loop 工具 `patch.prepare` 可提交 unified diff 走 `patch_apply` 审批（preview only，执行仍靠用户点「执行」）。
- A046 已完成：任务 SSE 含 `trace.linked`；主区可跳转历史 Trace；历史可「恢复到主工作区」并筛本次任务审批；`/api/agent/traces?taskId=` 按任务查 trace。
- A047 已完成：patch 审批用 `PatchFilesDiffView` 多文件 Tab；`DiffView` split 模式带变更前/后行号对齐。
- A048 已完成：活动流/审批展示 patch 多文件摘要；Patch 原文默认折叠；`patch.prepare` 会 `createPatchApproval` 并返回 `approval`。

### D021：压缩调优与本地验证脚本（A059）

决策：

- 压缩阈值可通过 `AGENT_LOOP_TAIL_KEEP`、`AGENT_LOOP_MIDDLE_MSG_TRIGGER`、`AGENT_LOOP_MIDDLE_TOKEN_TRIGGER` 调整；语义层用 `AGENT_LOOP_SEMANTIC_COMPACT=false` 关闭。
- 本地回归：`npm run validate:agent`（compaction + thread 延续，无需 LLM）。
- UI 收到 `context.compacted` 时自动滚到「滚动任务记忆」并提示查看 Pinned 审批 ID。

### D020：Loop 压缩 head 与 thread pinned（A058）

决策：

- 压缩 head 动态为：`system` →（可选）thread 滚动记忆 → **当前 Task 用户需求**；禁止把当前需求留在 middle 被压掉。
- 压缩合并 pinned 时，从 thread 记忆注入消息与 middle 一并抽取，确保跨 Task 的 `approval_*` 进入 `[COMPACTED_MEMORY]`。
- 本地验证：`npm run validate:compaction`（无需 LLM）。

### D019：活动流审批锚点（A057）

决策：

- 活动流中带审批的工具结果行可点击「查看审批」，滚动并高亮 `approval-anchor-{id}` 卡片。
- 收到 `approval.required` SSE 时自动滚到对应审查卡片。
- 三栏布局右侧下半恢复完整「变更审查」面板（含 diff）；中栏仍保留紧凑内联待授权区。

### D012：三栏工作区（A049，2026-05 落地）

决策：

A049 将首页改为 Cursor/Codex 向三栏：左（项目 + Trace 任务历史）、中（输入 + 紧凑活动流）、右（变更审查）；聊天/浏览器通过最左图标栏展开次级侧栏，不再用底部抽屉。

### D022：左侧栏按项目分组会话（A061）

- `GET /api/agent/threads?grouped=projects` 返回跨 Workspace 的项目列表；项目名为路径最后一级（如 `vec-next`）。
- 每个项目下默认展示最近 **5** 条会话（Thread），带相对时间；超出时提示「另有 N 个会话未显示」。
- 点击会话：选中 threadId，并自动恢复该会话下**最近一次** Trace 到主区活动流（**不**预填底栏输入，见 D025）。
- 左栏上部路径区标题为 **工作区**，其下树形区标题为 **项目**，避免重复用词。

### D023：只读 Loop 与「改代码」意图分离（A062）

- `isExplicitReadOnlyRequest`：含「只读」「不要修改」「不要执行」「只准备、不执行」等时，不算 `likelyEditRequest`。
- 避免「不要修改任何文件」里的「修改」触发缺审批反思；回归见 `npm run validate:loop-state`。

### D024：侧栏删除 ≠ 删磁盘（A063）

- **删会话**：`DELETE /api/agent/threads?threadId=&workspaceId=` → 清滚动记忆 + `thread-meta.hidden`；Trace JSON 保留。
- **移除项目**：`DELETE /api/agent/workspace?workspaceId=` → 写入 `.agent-state/workspace-sidebar.json` 的 `hiddenWorkspaceIds`；不删文件夹。
- **恢复项目**：`PATCH /api/agent/workspace` body `{ workspaceId, action: "show" }`。
- 左栏「新会话」与底栏「新会话」共用 `startNewSession`（清 thread、活动流、输入框）。

### D025：恢复 Trace 时的审批与输入框（A065）

- 恢复活动流时 **必须** 再拉 `/api/agent/approvals`，`mergeApprovalLists` 按进度优先：已执行 > 已批准 > 已拒绝 > 待审批。
- Trace 内 `approval.required` 事件是历史快照（多为 pending），不能覆盖持久化审批状态。
- **点击会话**：只看历史，不 `setRequest`。
- **悬停点「继续」**：才预填 `lastUserRequest`（A055 原意）。

### D026：黄金路径外部试用（A064）

- 试用脚本：`node scripts/golden-path-trial.mjs "<workspacePath>"`（默认 `D:\案例\aiproject`）。
- 用户外部试玩目录 `D:\案例\aiproject` 与 vec-next 仓库分离；改动的 `index.html` 在用户目录，不随 vec-next 提交。

仍缺、后续再做：

- 左栏 **文件树**（目前只有任务历史，没有 repo 文件浏览）
- 中栏 **内嵌编辑器**（目前中栏仍是活动流，不是代码编辑区）
- **何时做桌面端（Electron）**：在 Web 版已跑通「Loop → 审批 → 执行」且你本人能接受粘贴 workspace 路径的前提下，**不必急着做桌面端**。建议在出现以下 2～3 项时再立项：① 需要系统目录选择器（非技术用户不能粘贴路径）；② 需要可靠 Chrome DevTools / WebView（iframe 被 CSP 挡住你的主流程）；③ 需要本地 shell 命令审批且沙箱要强隔离；④ 需要离线或内网单机部署。在此之前继续用 Web + `src/agent` 与 UI 解耦，桌面壳以后可复用同一套 API。
- 当前 Trace Store 会同时写入内存和 `.agent-traces/` 本地 JSON 文件，并可通过 `/api/agent/traces` 查询。
- `.agent-traces/` 已加入 `.gitignore`，不要提交运行 trace。
- 当前 Trace 持久化还不是 SQLite；如果后续需要复杂查询、过滤、分页，再升级。
- 当前支持通过 `/api/agent/workspace` 和 AgentPanel 手动设置 workspace 路径，配置落在 `.agent-state/workspace.json`。
- `.agent-state/` 已加入 `.gitignore`，不要提交本地 workspace 配置。
- 当前 Workspace 选择是 Web 阶段的路径输入方案；真正系统目录选择器留到 Electron 或本地客户端。
- 当前项目规则读取支持多层 `AGENTS.md`：会递归读取 workspace 内的 `AGENTS.md`，跳过 `.git`、`.next`、`.agent-state`、`.agent-traces`、`node_modules`、`dist`、`build`、`coverage`。
- 规则文件对象包含 `path`、`content`、`truncated`、`scopePath`、`depth`、`source`；`selectProjectRulesForPath` 可按目标文件选择适用规则。
- 根目录 `README.md` 和 `CLAUDE.md` 仍作为全局规则/项目背景读取，不按目录 scope 递归。
- AgentPanel 的 Workspace 区域需要保留明确的读取/设置反馈；如果用户说“设置按钮点不动”，优先检查路径输入、接口返回和 UI 状态提示。
- 产品方向上应预留桌面端。浏览器环境无法像 Codex 桌面端那样可靠弹出系统目录选择器并把本机路径交给服务端；Electron/本地客户端更适合承载项目选择、本地文件读写、命令执行、Chrome DevTools 连接和权限沙箱。
- 迁移策略不是立刻重写成 Electron，而是继续保持 Agent Runtime 与 UI 解耦，先把 `src/agent` 能力做稳，再让 Web UI 和 Electron UI 共享同一套本地 runtime/API。
- 当前优先级建议：A062–A065 已完成；下一步 **git.status 结构化**、大文件 diff、长任务压缩复测。
- 接续入口：恢复 Trace 后审批/输入框行为见 D025；外部 workspace 试用见 D026。
- A034 已完成：ApprovalRecord 增加可 JSON 持久化的 `details` 字段，`/api/agent/files` 和 `/api/agent/git` 的 preview 会写入 operation、operationHash 和 preview。
- A034 文件详情已包含：operation type、path/fromPath/toPath、existsBefore/existsAfter、oldSize/newSize、sizeDelta、oldContent/newContent 的截断快照。
- A034 Git 详情已包含：operation type、preview command、branchName/branch/remote/setUpstream、risk notes。后续可继续补 git status/diff 快照，但这不阻塞 A035。
- A034 验证：`npm run lint`、`npm run build` 通过；文件/Git preview smoke 的 approval 已生成并带 details；两个 smoke approval 已拒绝，未创建 `tmp/a034-preview-only.txt`，未创建 `codex/smoke-a034` 分支。
- A035 已完成：新增 `/api/agent/approvals/execute`，服务端从已批准 approval.details 读取 operation 并调用文件/Git apply；前端只传 approvalId。
- A035 安全设计已落地：`批准` 和 `执行` 是两个动作。批准只改变 approval 状态，执行必须由用户再次点击触发，不能由模型或 UI 自动 apply。
- A035 验证：未批准 execute 返回 400；文件 create approval 批准后二次点击可执行，重复执行成功 approval 返回 409；Git apply 只测试了低风险 branch 创建，测试分支已删除。
- A036 验证：请求“把这个项目首页的 鹊桥 2个字去掉”会生成 `src/app/page.tsx` 的待审批 `Write file`，旧内容有“鹊桥”，新内容没有“鹊桥”；验证 approval 已拒绝，未实际改首页。
- A036 技术注意：PowerShell `Invoke-WebRequest` 读取 SSE 时可能抛客户端空引用，验证 SSE 事件流优先用浏览器或 Node `fetch`。
- A036 复测发现：旧 approval 没有 `details` 时即使是 approved，也不能通过新的 execute API 执行。AgentPanel 已增加旧审批提示，后续不要让用户误点旧审批。
- A036 复测结果：重新生成并执行“去掉首页鹊桥”的新 approval 后，`src/app/page.tsx` 已实际移除“鹊桥”，并通过 `npm run lint` / `npm run build`。
- A036 后续补坑：普通 Agent Loop 的通用工具分支原先只发 `tool.completed`，没有在工具结果带 `approval` 时统一发 `approval.required`。这会导致审批其实已落到 `.agent-state/approvals.json`，但前端在当次任务里不一定立刻显示。现已在 `src/agent/core/agent-loop.ts` 统一补发。
- AgentPanel 现在会在接收到 `approval.required` SSE 事件时立刻把新审批插入列表，而不是只等任务结束后重新请求 `/api/agent/approvals`。
- 当前审批列表排序策略：`pending` 优先于 `approved/rejected`，同状态下按 `createdAt` 倒序；当前任务新产生的审批会显示“本次任务”标记，方便从历史审批堆里快速识别。
- 2026-05-27 实测：通用改代码请求“把 `src/app/page.tsx` 里的 `AI Chat × Vercel` 改成 `AI Chat × Codex`”会在普通 Agent Loop 中读取目标文件、生成新的 pending approval，并写入 `.agent-state/approvals.json`；不再只对首页“去掉某段文本”的兜底请求有效。
- 后续测试边界：不要测试 commit/push，除非用户重新明确授权。不要安装依赖、不要删除真实文件、不要改 `.env` 或密钥文件。
- 暂时不引入 LangChain。当前项目更需要 Codex-like 的轻量 Agent Runtime、审批、trace、patch 和上下文控制；LangChain 可能增加抽象复杂度，等后续确实需要现成 retriever/graph 编排时再评估。
- 暂时不引入 LangGraph。当前还没有复杂多节点状态机和多 agent graph 需求，先把自研 Agent Runtime 主链路跑通；等需要可恢复 graph、分支执行或多 agent 编排时再评估。

## 待补充信息

- 用户已经跑通的 Chrome DevTools 提示词内容。
- 当前模型接口最终要支持哪些供应商。
- 本地工作区选择方式：网页配置路径、Electron 文件选择器，还是本地 agent-server 配置。
- 是否需要先支持单项目，还是早期就支持多 workspace。

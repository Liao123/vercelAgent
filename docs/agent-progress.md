# 开发智能体项目进度

更新时间：2026-06-01

本文档用于记录开发智能体项目的工作项、当前状态、验收标准和执行记录。后续每完成一个工作项，都必须更新本文档。

## 状态说明

```text
todo        尚未开始
doing       正在进行
blocked     被阻塞，需要用户决策或外部条件
done        已完成并通过基本验证
deferred    暂缓，不属于当前阶段
```

## 更新规则

后续 AI 或开发者必须遵守：

1. 开始一个工作项前，把对应状态改为 `doing`。
2. 完成一个工作项后，把状态改为 `done`，并填写完成记录。
3. 如果遇到阻塞，把状态改为 `blocked`，写清楚阻塞原因和需要谁决策。
4. 不要只在聊天里说完成，必须同步更新本文档。
5. 涉及架构决策时，同时更新 `docs/agent-memory.md`。
6. 涉及新增能力时，必须写清楚验收标准。
7. 不要把密钥、token、私有账号信息写入本文档。

## 当前阶段目标

当前阶段先不大改项目结构，目标是把现有 Next.js 聊天应用逐步变成任务型开发智能体原型。

主链路：

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

MVP 阶段对照表见 [`docs/agent-architecture.md` §20](agent-architecture.md#20-mvp-实现顺序)（2026-06-01 更新）。

设计解析链路：

```text
内置浏览器
  -> AI 能打开指定网址
  -> 用户和 AI 可以基于页面继续开发任务
```

## 工作项列表

| ID | 状态 | 工作项 | 验收标准 |
| --- | --- | --- | --- |
| A001 | done | 建立架构规划文档 | `docs/agent-architecture.md` 已存在，并说明 Codex-like 架构、Chrome DevTools 主线、上下文压缩、权限、trace、MVP 顺序。 |
| A002 | done | 建立项目进度文档 | `docs/agent-progress.md` 已存在，包含工作项、状态说明、更新规则和验收标准。 |
| A003 | done | 建立本地记忆文档 | `docs/agent-memory.md` 已存在，记录项目事实、架构决策、用户偏好和后续注意事项。 |
| A004 | done | 新增 `src/agent` 骨架 | 创建 `src/agent` 下的核心目录，不改变现有页面功能。 |
| A005 | done | 抽象 `ModelProvider` | 模型调用统一走 provider 接口，现有 OpenAI 兼容接口可接入。 |
| A006 | done | 定义核心类型 | 定义 `Thread`、`Task`、`Turn`、`AgentEvent`、`AgentPlan`、`ApprovalRequest`。 |
| A007 | done | 建立任务事件流 | 聊天响应可输出任务事件，而不是只返回纯文本。 |
| A008 | done | 建立 Trace Store 雏形 | 记录任务、模型输出、工具调用、文件变更和验证结果。 |
| A009 | done | 建立 Workspace Manager | 支持记录当前项目路径、Git 根目录、框架信息和项目规则。 |
| A010 | done | 读取项目规则 | 能读取 `AGENTS.md`、README、package 信息和基础配置。 |
| A011 | done | 增加文件工具 | 支持目录扫描、读文件、搜索文件。 |
| A012 | done | 增加 Git 工具 | 支持 `git status`、`git diff`，后续再扩展 branch/commit。 |
| A013 | done | 增加 patch 修改工具 | AI 通过 patch 修改文件，修改后能展示 diff。 |
| A014 | done | 增加审批机制 | 写文件、删文件、执行命令、安装依赖等高风险操作需要确认。 |
| A015 | done | 建立上下文管理骨架 | 区分系统规则、项目规则、Thread Memory、Task Memory、Turn Context。 |
| A016 | done | 增加上下文压缩机制 | 长对话、旧工具结果、大日志能压缩为结构化摘要。 |
| A017 | done | 增加 token 预算管理 | 每次模型请求前计算上下文预算，预留输出空间。 |
| A018 | done | 建立项目索引 | 扫描路由、页面、组件、接口、业务关键词、文件摘要。 |
| A019 | done | 中文需求定位文件 | 用户说页面或模块中文名称时，能定位相关文件候选。 |
| A020 | done | 增加验证工具 | 支持 lint/build/test 等项目验证命令。 |
| A021 | done | 跑通开发闭环 | 需求 -> 定位文件 -> 计划 -> 修改 -> 验证 -> 总结。 |
| A022 | done | 增加内置浏览器 UI | 产品内可以打开目标网址或本地页面，AI 可以触发打开指定 URL。 |
| A023 | deferred | Chrome DevTools 深度读取 | DOM、元素宽高、样式、console、network、design spec 等能力先暂缓。 |
| A024 | deferred | 页面生成/复刻流程 | demo URL + 素材 + design spec -> 修改代码 -> 浏览器验证，先暂缓。 |
| A025 | deferred | Electron 桌面端 | 主链路稳定后再做，不作为当前阶段目标。 |
| A026 | done | Trace Store 持久化 | Trace 不再只存在内存 Map，支持 SQLite 或文件落盘，重启后可恢复。 |
| A027 | done | Workspace 项目选择 | 支持用户选择或配置项目路径，而不是固定使用 Next.js 进程 cwd。 |
| A028 | done | 真正 Agent Loop | 模型能基于事件和工具结果循环推理，而不是只跑固定开发闭环。 |
| A029 | done | 完整文件修改能力 | 支持创建文件、删除文件、重命名文件和更完整 patch 格式，全部走审批。 |
| A030 | done | Git 写操作 | 支持 branch、commit、push 等 Git 写操作，全部走审批。 |
| A031 | done | 多层项目规则合并 | 支持多层 `AGENTS.md`/规则文件按目录作用域合并。 |
| A032 | done | 前端 UI 接 Agent 事件流 | 页面能展示开发闭环事件：计划、工具调用、候选文件、审批、验证和总结。 |
| A033 | done | 前端审批 UI | 页面能展示 approval 列表，并支持刷新、批准和拒绝。 |
| A034 | done | 审批详情快照 | Approval 记录能保存文件/Git 操作的结构化预览，前端可查看 diff、命令、风险和影响范围。 |
| A035 | done | 审批后的执行闭环 | 用户批准后，前端能对已批准的文件/Git 操作发起 apply，并展示执行结果；仍禁止自动执行。 |
| A036 | done | Agent Loop 可用改代码入口 | 默认运行 Agent Loop；模型能准备文件改动审批；简单首页文本删除请求能稳定生成待审批改动。 |
| A037 | done | 统一 Agent Workspace UI | 首页改为单页 Agent 工作区：左侧活动流、右侧变更审查；聊天/浏览器收起到底部辅助面板，更接近 Codex/Cursor Agent。 |
| A038 | done | Patch 审批详情与执行 | `patch_apply` 写入 approval.details；开发闭环 patch preview 可持久化 diff；`/api/agent/approvals/execute` 支持 patch apply。 |
| A039 | done | 审查与活动流产品化 | 审批区行级 diff 高亮（`DiffView`）；活动流类型筛选与调试 JSON 开关；Git commit/push 高风险提示。 |
| A040 | done | Git 审批工作区快照 | Git preview 持久化 branch、status、diff、push 时 remote URL；审批 UI 展示快照。 |
| A041 | done | Shell 白名单审批 | `shell.command.prepare` + `/api/agent/shell`；仅 lint/build/test/typecheck；execute 走审批闭环；Push 二次确认执行。 |
| A042 | done | Trace 历史 UI | Agent Workspace「历史」面板浏览 `.agent-traces/`；列表 + 可读事件时间线。 |
| A043 | done | Patch parser 增强 | unified diff 支持新建（/dev/null）、删除、重命名与修改；审批 UI 展示操作类型。 |
| A044 | done | 审查与活动流 UI 增强 | `DiffView` 默认 split 左右对照、可切换统一 diff；活动流合并 tool.started/completed、可折叠工具/计划/反思行。 |
| A045 | done | Agent Loop `patch.prepare` | Loop 可提交 unified diff 生成 `patch_apply` 审批；不直接写盘；与 file.replace/mutation.prepare 并列。 |
| A046 | done | Trace 与当前任务联动 | SSE `trace.linked`；主区「在历史 Trace 中查看」；历史面板「恢复到主工作区」+ 当前任务标记；`GET /api/agent/traces?taskId=`。 |
| A047 | done | 多文件 Patch Diff UI | `PatchFilesDiffView` 按文件 Tab 切换；split diff 左右行号对齐（`toSplitAlignedRows`）。 |
| A048 | done | Patch 活动流摘要与原文折叠 | 工具/审批展示多文件摘要；patch 原文默认折叠；`patch.prepare` 正确创建 approval。 |
| A049 | done | 三栏 Agent 工作区（Cursor/Codex 向） | 左：项目+任务历史；中：输入+紧凑活动流；右：变更审查；图标栏切换聊天/预览。 |
| A050 | done | Codex 向信息流布局 | 中：对话 Turn + 逐步推理时间线 + 底栏输入；右：变更审查 + 内置浏览器（**不再**展示任务规划步骤）；移除 Agent 页通用 Chat 入口。 |
| A051 | done | Agent Loop 上下文压缩（Codex 风格） | `loop-context-compactor` 接入 Loop：工具结果整形、head/tail 保留、中间段确定性+可选语义 compact；SSE `context.compacted`；活动流可见压缩事件。 |
| A052 | done | 滚动任务记忆 + Pinned Facts | 增量合并 prior memory、结构化 `## Pinned/Summary/Changed files`、`ModelProvider.compact`、审批观测瘦身、右栏任务记忆。 |
| A053 | done | Trace 全文记忆 + Thread 跨任务 | `context.compacted.memoryContent` 写入 Trace；`.agent-state/thread-memory.json`；Loop `threadId` 延续；Trace/中栏记忆面板；「延续会话记忆」开关。 |
| A054 | done | 会话侧栏 + 记忆摘要索引 | `/api/agent/threads`；左栏会话列表（摘要/轮次）+ 按会话筛选任务；压缩同步 `summaryPreview` 到 thread-memory 与 trace.thread。 |
| A055 | done | 会话管理操作 | PATCH 重命名、`thread-meta.json`、DELETE 删滚动记忆、侧栏「继续/命名/删记忆」、预填上次需求。 |
| A056 | done | 体验与说明 | 内联重命名、记忆导出 Markdown、记忆面板复制/导出、Loop vs 闭环模式说明组件。 |
| A057 | done | 活动流 → 审批锚点 | 活动流中 `tool.completed`（含审批）可点「查看审批」或点行定位；新 `approval.required` 自动滚到审查区；三栏右侧恢复「变更审查」面板。 |
| A058 | done | 长任务压缩验证与修复 | 动态 head 保留 thread 记忆 + 当前用户需求；thread pinned 合并；`npm run validate:compaction`；活动流「上下文已压缩」→ 记忆面板锚点。 |
| A059 | done | 压缩调优与 Thread 验证 | 语义 compact 提示词强化；`AGENT_LOOP_*` 环境变量；`validate:thread-memory` + `validate:agent`；压缩 SSE 自动滚到记忆面板。 |
| A060 | done | E2E 体验修复 | 大文件小改动审批 diff 围绕变更行截取；启动自动读取 Workspace；中栏隐藏历史「已批准待执行」；内联审批区分历史/本次；活动流空态提示恢复 Trace。 |
| A061 | done | 左侧栏按项目分组会话 | `GET /api/agent/threads?grouped=projects`；项目（Workspace 文件夹名）下展示最近 5 条会话 + 相对时间；点击会话恢复该会话最近一次 Trace；移除独立「任务」列表；路径区标题改为「工作区」。 |
| A062 | done | 只读 Loop 反思修复 | `isExplicitReadOnlyRequest` 排除「不要修改」等；`scripts/validate-loop-state.ts` + `npm run validate:loop-state`；活动流空态改为「项目 → 会话」。 |
| A063 | done | 侧栏会话与项目管理 | 左栏「新会话」；会话悬停「继续/命名/删除」；`thread-meta.hidden` + `DELETE /api/agent/threads`；项目悬停「移除」+ `workspace-sidebar.json` + `DELETE/PATCH /api/agent/workspace`。 |
| A064 | done | 黄金路径试用脚本 | `scripts/golden-path-trial.mjs`：设 workspace → Loop → 批准 → execute → 校验磁盘；已在 `D:\案例\aiproject` 验证通过。 |
| A065 | done | 恢复 Trace 体验修复 | 恢复会话时 `mergeApprovalLists` 优先已批准/已执行状态并拉取 `/api/agent/approvals`；点击会话不再预填底栏输入（仅「继续」预填）；「新会话」清空输入框。 |
| A066 | done | 结构化 Git 状态 + Codex 风格展示 | `git.status` 返回 `{ dirty, branch, ahead, behind, files[] }`；`workspace.git` 结构化；活动流/ Git 审批用 `GitStatusView`；`npm run validate:git-status`。 |
| A067 | done | 中文任务规划 + 大文件 diff 打磨 | `agent-loop-plan.ts` 中文五步 + `plan.updated` 运行态同步（UI 展示见 A071）；反思「理解/下一步」；`contentSnapshotPair` 行号对齐 + `validate:content-snapshot`。 |
| A068 | done | 长任务延续会话多轮压缩 | `validate-long-thread-compaction`（Task1 压 2 轮 → thread → Task2 压 3–4 轮）；tail 审批钉住；记忆模板/ UI 中文化。 |
| A069 | done | 语义 vs 确定性压缩对比 | `semantic-compact-compare.mjs` + `npm run trial:semantic-compare`；导出 `.agent-state/compare/semantic-{on,off}.md`。 |
| A070 | done | Codex/Cursor 式 Turn 折叠活动流 | `groupEventsIntoTurns` + `AgentTurnBlock`；Worked 默认折叠、交付摘要 + 变更条；筛选非「全部」时退回平铺。 |
| A071 | done | 中栏逐步推理时间线（Cursor/Codex 向） | 推理/工具在中栏总折叠展示；反思→打算→工具链；`tool_call.thought`；不含技术日志；右栏仅浏览器。 |

## 完成记录

### 2026-06-01（续）

- A071 已完成：中栏 `TurnReasoningTimeline` 按「反思 → 工具动作」分组；运行中实时计时、完成后总折叠自动收起；流式 `reflect` 预览显示为「思考中…」；`ToolCallRecord.rationale` 来自模型 `thought`；工具步骤图标；中栏不展示技术日志（见 Trace/记忆面板）；右栏仅内置浏览器。
- 涉及文件：`agent-turn-reasoning-timeline.tsx`、`agent-reasoning-steps.ts`、`agent-turn-block.tsx`、`agent-turn-feed.ts`（`narrativeEvents` / `detailEvents`）、`agent-right-rail.tsx`、`agent-loop.ts`。

### 2026-06-01

- A070 已完成：中栏活动流按 `task.created` 分组为 Turn；用户气泡 →「已完成本轮执行/工作中」折叠包（工具/反思/压缩）→ 高亮（验证/文件变更）→ 交付摘要 → Codex 风格变更条（待审批/已写入 + 审查跳转）；最新 running 轮 Worked 默认展开；`parse-agent-final` 提取 Loop final summary。

- A066 已完成：`src/lib/git-status.ts` 解析 `git status --short --branch`；`git.status` / `workspace.inspect` 返回结构化 `{ dirty, files[], summary }`；Loop 观测瘦身；活动流 dirty 时自动展开 `GitStatusView`；Git commit/push 审批快照带 `statusSnapshot`。
- A067 已完成：`agent-loop-plan.ts` 中文五步规划 + 运行态同步（`plan.updated` 仍写入事件流，**UI 不再在右栏展示**）；系统提示词要求 reflect/final 用中文、`tool_call` 带中文 `thought`；大文件 diff `startLine` 行号对齐 + `validate:content-snapshot`。**展示层**已由 A071 中栏推理时间线取代原右栏「当前思路」。
- A068 已完成：`scripts/validate-long-thread-compaction.ts`（Task1→2 轮压→thread→Task2→3–4 轮压）；压缩时从 tail 钉住审批 ID；`[COMPACTED_MEMORY]`/`[THREAD_MEMORY]` 模板中文化；活动流/记忆面板 `deterministic`→「确定性压缩」。
- A069 已完成：`scripts/semantic-compact-compare.mjs` 两轮对比导出；实机结果见 `.agent-state/compare/`（本轮两次均为 deterministic，语义层未触发 middle 阈值；关语义时压缩更频繁 5 次、末轮 token 略低）。
- 验证：`npm run validate:agent`、`npm run lint`、`npm run build` 通过。

### 2026-05-29

- **验证**：`npm run validate:agent`（compaction + thread-memory + loop-state）通过；浏览器实机验证工作区、内置浏览器、会话恢复、只读 Loop；`golden-path-trial` 在 `D:\案例\aiproject` 改 `index.html` 标题全流程通过。
- A062 已完成：只读任务不再误触发「缺少审批」多轮反思；`validate:loop-state` 接入 `validate:agent`。
- A063 已完成：补 A055 遗漏的侧栏「删除」；项目可从左栏移除（不删磁盘），底部可「恢复已隐藏项目」；跨 workspace 删会话带 `workspaceId` 参数。
- A064 已完成：`scripts/golden-path-trial.mjs`；试用项目在 `D:\案例\aiproject`（用户自建目录，非 vec-next 仓库内）。
- A065 已完成：修复「点进历史会话后审批又变待授权」；修复「点进会话底栏需求被反复填充」。
- 验证：`npm run lint` 通过。
- **用户偏好（再次确认）**：暂不做左栏文件树、内嵌编辑器；不必再投入开发闭环；日常只用 Agent Loop。

### 2026-05-28

- A061 已完成：`buildAgentProjectSidebar` + `listAllThreadMemories`/`listAllThreadMetas`；侧栏改为「项目 → 会话」树形（每项目最多 5 条、可展开）；点击会话自动恢复最近任务活动流；顶栏路径区与侧栏标题区分（工作区 / 项目）。短话术 E2E 与「拒绝审批」已在浏览器/API 验证通过。
- 产品文案：`agent-panel` 底栏 placeholder 已改为「描述编程任务，可附图…」。
- 验证：`npm run lint`、`npm run build` 通过。
- A060 已完成：`contentSnapshotPair` 围绕 diff 行截取审批快照，修复大文件 placeholder 类改动 diff 为空；页面加载自动 GET workspace；中栏内联审批仅展示当前任务「已批准待执行」、历史 pending 带「历史」标记；三栏活动流空态提示点击左侧任务恢复。
- 验证：`npm run lint`、`npm run build` 通过。
- A059 已完成：`loop-compaction-config`（tail/middle 阈值、`AGENT_LOOP_SEMANTIC_COMPACT`）；语义 compact 提示词强调保留 `approval_*`；`scripts/validate-thread-continuation.ts`；`npm run validate:agent`；收到 `context.compacted` 时 UI 自动定位记忆面板。
- 验证：`npm run validate:agent`、`npm run lint`、`npm run build` 通过。
- A058 已完成：修复延续会话时当前 user 任务被压进 middle 的 bug；压缩时合并 thread 记忆里的 pinned approval；`git/shell.command.prepare` 观测瘦身；新增 `scripts/validate-loop-compaction.ts` + `npm run validate:compaction`；活动流「上下文已压缩」可点「查看记忆」定位面板。
- 验证：`npm run validate:compaction`、`npm run lint`、`npm run build` 通过。
- A057 已完成：活动流工具行与审批事件可滚动定位到内联/审查区审批卡片（`approval-anchor` + 高亮环）；收到 `approval.required` 时自动 `focusApproval`；三栏布局右侧下半为完整「变更审查」+ diff。
- 验证：`npm run lint`、`npm run build` 通过。

### 2026-05-27

- A001 已完成：建立并升级 `docs/agent-architecture.md`。
- A002 已完成：建立 `docs/agent-progress.md`。
- A003 已完成：建立 `docs/agent-memory.md`。
- A004 已完成：新增 `src/agent` 骨架，并增加 `src/agent/README.md` 说明目录职责。
- A005 已完成：新增 `src/agent/model`，并把现有 `/api/chat` 接入 `ModelProvider`。
- A006 已完成：新增 `src/agent/types.ts`，定义 Thread、Task、Turn、AgentEvent、AgentPlan、ApprovalRequest 等核心类型。
- A007 已完成：新增 `src/agent/protocol/stream.ts` 和 `/api/agent/tasks`，提供任务事件流雏形。
- A008 已完成：新增 `src/agent/trace/trace-store.ts`，当前使用内存 Map 记录 trace。
- A009 已完成：新增 `Workspace Manager`，当前使用 Next.js 进程 cwd 作为 workspace。
- A010 已完成：新增项目规则读取工具，支持读取 `AGENTS.md`、`README.md`、`CLAUDE.md`。
- A011 已完成：新增只读文件工具，支持目录扫描、文本文件读取和文本搜索。
- A012 已完成：新增 Git 只读工具，支持 git root、status、diff。
- 验证：`npm run build` 通过。
- 已修复：`npm run lint` 已通过。修复了 `src/components/message-body.tsx` 的 `react-hooks/set-state-in-effect` 问题、图片标签 lint 警告和 `scripts/test-vision-file.mjs` unused catch 参数。
- 已知警告：`npm run build` 有一个 Turbopack NFT tracing 警告，来源是 workspace API 引入文件系统读取。当前不影响构建通过，后续拆出本地 agent-server 后应自然消失。
- A013 已完成：新增 `src/agent/tools/patch-tools.ts` 和 `/api/agent/patch`。当前支持 unified diff 预览和应用，所有目标路径限制在 workspace 内。
- A014 已完成：新增 `src/agent/approval` 和 `/api/agent/approvals`。应用 patch 必须先创建并批准与该 patch hash 绑定的 approval，避免批准 A 却执行 B。
- A013 当前限制：只支持修改已存在文件的连续 hunk；暂不支持新建文件、删除文件、重命名文件、二进制文件和复杂 git patch。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A015 已完成：新增 `src/agent/memory`，支持把系统规则、项目规则、Thread Memory、Task Memory、Turn Context、检索上下文和工具结果整理成分层 `ContextSection`。
- A015 已接入：`/api/agent/tasks` 的 workspace scan 结果现在会返回 context section 摘要和估算 token 数。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A016 已完成：新增 `src/agent/memory/context-compressor.ts`，支持把多段 `ContextSection` 压缩成结构化 `ContextSummary`。
- A016 已接入：`/api/agent/tasks` 在上下文超过阈值时会产出 `context.compacted` 事件，并在 workspace scan 结果里返回压缩前后 token 估算。
- A016 当前限制：这是确定性压缩骨架，不调用模型做语义级 compact；后续可在同一接口后接模型摘要。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A017 已完成：新增 `src/agent/memory/token-budget.ts`，支持配置最大输入 token、预留输出 token、压缩阈值，并按 section 优先级筛选上下文。
- A017 已接入：`buildAgentContext` 会先应用 token 预算，`/api/agent/tasks` 的 workspace scan 结果会返回 budget 摘要。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A018 已完成：新增 `src/agent/indexer` 和 `/api/agent/index`，可扫描当前 workspace 的页面、API route、组件、imports、exports、业务关键词和文件摘要。
- A018 当前限制：这是无依赖轻量内存索引，还没有 SQLite 持久化、AST 精确分析和向量检索。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A019 已完成：新增 `src/agent/indexer/file-locator.ts` 和 `/api/agent/locate`，支持根据中文/自然语言需求返回候选文件、分数和命中原因。
- A019 当前限制：定位器是规则/关键词打分版，还没有 embedding、AST 引用图和历史任务记忆加权。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A020 已完成：新增 `src/agent/verification` 和 `/api/agent/verify`，只运行 package.json 中存在的白名单 npm scripts：lint、build、test、typecheck。
- A020 当前项目脚本状态：存在 lint/build，缺少 test/typecheck。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A021 已完成：新增 `src/agent/core/development-loop.ts` 和 `/api/agent/develop`，串起需求、项目索引、文件定位、可选 patch 预览/应用、验证和总结。
- A021 当前限制：还不会让模型自动生成 patch；如果要修改文件，需要调用方显式传入 patch，且 apply 时仍必须提供匹配 approval。
- A021 当前限制：前端 UI 还没有接入开发闭环事件流。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- Backlog 已补充：A026-A031 记录 Trace 持久化、Workspace 选择、真正 Agent Loop、完整文件修改、Git 写操作和多层规则合并。
- A032 已开始：前端 UI 接 Agent develop 事件流。
- A032 已完成：新增 `src/components/agent-panel.tsx`，首页改为聊天 + 开发智能体双栏布局。面板可调用 `/api/agent/develop` 并按计划、工具调用、审批、验证、结果、其他事件分组展示 SSE 事件。
- A032 当前限制：事件展示还是 JSON 调试视图，尚未做精细化 diff/approval 交互，也未接 patch 输入。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- 本地 dev server 已在 `http://localhost:3000` 运行；尝试启动新 dev server 时检测到已有进程，因此没有重复启动。
- A026 已完成：Trace Store 现在同时写入内存和 `.agent-traces/` 本地 JSON 文件，并新增 `/api/agent/traces` 只读查询接口。
- A026 已处理：`.agent-traces/` 已加入 `.gitignore`，避免运行记录进入 Git。
- A026 当前限制：当前是 JSON 文件持久化，还不是 SQLite；适合 MVP 恢复和审计，后续需要查询/过滤时再升级。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A027 已完成：新增 `.agent-state/workspace.json` 本地配置能力，`/api/agent/workspace` 支持 GET 当前 workspace 和 POST 设置 workspace 路径。
- A027 已接入：AgentPanel 增加 workspace 路径输入、设置和刷新按钮。
- A027 当前限制：Web 版是手动输入路径；真正系统目录选择器留到 Electron 或本地客户端。
- A027 已处理：`.agent-state/` 已加入 `.gitignore`，避免本地 workspace 配置进入 Git。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A027 已修正：AgentPanel 的 Workspace 区域增加明确的读取/设置状态反馈，并把按钮文案改为 `读取当前`，避免用户点击后误以为无响应。
- A027 决策补充：当前不立即重写成 Electron；但产品方向确认应预留桌面端，因为系统目录选择器、本地项目读写、命令执行、Chrome DevTools 和沙箱权限都更适合桌面壳或本地客户端承载。
- A022 已完成：新增 `src/agent/browser`、`/api/agent/browser` 和 `src/components/browser-panel.tsx`，首页现在包含聊天、内置浏览器和开发智能体三块区域。
- A022 已接入：浏览器面板支持输入 URL 并用 iframe 预览；`/api/agent/browser` 可 GET 当前目标、POST 打开 URL。
- A022 已接入：`/api/agent/develop` 会从用户需求中识别第一个可打开 URL，并产出 `browser.open` 工具事件，作为 AI 触发打开 URL 的占位能力。
- A022 已修正：浏览器目标状态写入 `.agent-state/browser.json`，避免 Next.js 不同 route/runtime 实例之间只靠内存状态导致面板无法感知 Agent 打开的 URL。
- A022 当前限制：Web 版 iframe 会受站点 `X-Frame-Options` / `Content-Security-Policy` 限制，部分外部网站无法嵌入；Electron 阶段需要替换为 WebView/Chrome DevTools 主线能力。
- A028 已完成：新增 `src/agent/core/agent-loop.ts`、`src/agent/core/agent-loop-tools.ts` 和 `/api/agent/loop`，模型可按 JSON 协议循环选择工具或结束任务。
- A028 已接入：AgentPanel 增加 `开发闭环` / `Agent Loop` 模式切换；`Agent Loop` 模式会请求 `/api/agent/loop` 并持续展示模型输出、工具调用和最终结果事件。
- A028 已开放工具：`workspace.inspect`、`project.index`、`file.locate`、`file.list`、`file.read`、`file.search`、`git.status`、`git.diff`、`browser.open`。
- A028 当前限制：loop 只开放只读/低风险工具；写文件、shell、Git 写操作、安装依赖仍不进入该 loop，后续必须接审批与沙箱。
- A028 当前限制：模型必须返回严格 JSON；无效 JSON 会停止 loop 并产出总结。后续可增强为更稳健的修复/重试协议或结构化输出接口。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A029 已完成：新增 `src/agent/tools/file-mutations.ts` 和 `/api/agent/files`，支持 `create`、`write`、`delete`、`rename` 四类文件变更。
- A029 已接入审批：`preview` 会生成与文件变更内容 hash 绑定的 approval；`apply` 必须携带匹配且已批准的 `approvalId`，否则拒绝执行。
- A029 已接入 Agent Loop：新增 `file.mutation.prepare` 工具，模型可以准备文件变更和审批请求，但不能直接 apply。
- A029 安全验证：调用 create preview 只生成 approval 和预览，未创建文件；apply 缺少 `approvalId` 返回 400；`tmp/a029-smoke.txt` 未被创建。
- A029 当前限制：旧 `applyUnifiedPatch` 仍只支持修改已存在文件的连续 hunk；新建/删除/重命名建议走 `/api/agent/files` 的结构化操作，后续再统一更完整 patch parser。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A033 已完成：AgentPanel 增加审批区域，支持加载 approval 列表、查看风险/原因/action、批准 pending approval 和拒绝 pending approval。
- A033 已接入：页面首次加载会自动读取 `/api/agent/approvals`，任务结束后也会刷新审批列表。
- A033 已修正：Approval Store 从纯内存 Map 升级为内存 + `.agent-state/approvals.json`，避免 Next route 实例或页面刷新后审批请求丢失。
- A033 验证：通过 `/api/agent/files` preview 生成 pending approval；页面刷新后审批 UI 自动显示；点击 `拒绝` 后状态变为已拒绝；未写入任何文件。
- A033 当前限制：审批 UI 还没有展示结构化 diff/文件内容对比；当前只展示 title、reason、risk、action 和状态。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A030 已完成：新增 `src/app/api/agent/git`，支持 Git `branch`、`commit`、`push` 三类写操作的 preview/apply。preview 会创建与操作 hash 绑定的 approval，apply 必须携带匹配且已批准的 `approvalId`。
- A030 已接入 Agent Loop：新增 `git.mutation.prepare` 工具，模型只能准备 Git 写操作 approval，不能直接执行 branch/commit/push。
- A030 安全验证：调用 branch preview 只生成 approval 和命令预览；apply 缺少 `approvalId` 返回 400；`codex/smoke-a030` 分支未被创建。
- A030 当前限制：未在本轮实际执行 branch/commit/push；push 属高风险操作，后续审批 UI 应展示更完整的 Git status/diff/remote 信息后再给用户批准。
- A031 已完成：`readProjectRules` 现在会递归读取 workspace 内多层 `AGENTS.md`，并保留根目录 `README.md`、`CLAUDE.md`。
- A031 已完成：规则文件新增 `scopePath`、`depth`、`source` 字段，并提供 `selectProjectRulesForPath` 按文件路径选择适用规则。
- A031 验证：`/api/agent/workspace` 返回的规则对象已包含 `scopePath`、`depth`、`source`。
- A034 已完成：ApprovalRecord 增加 `details` 快照，支持持久化文件变更和 Git 写操作的 operation、operationHash、preview。
- A034 已接入文件变更：`/api/agent/files` preview 生成的 approval 会保存文件操作类型、路径、存在状态、大小变化，以及截断后的 before/after 内容快照。
- A034 已接入 Git 写操作：`/api/agent/git` preview 生成的 approval 会保存 Git 操作类型、目标参数、预览命令、风险等级和风险说明。
- A034 已接入前端：AgentPanel 审批列表会展示文件详情、before/after 内容预览、Git 命令和风险 notes；页面刷新后可通过 `/api/agent/approvals` 恢复详情。
- A034 验证：`npm run lint` 通过，`npm run build` 通过；通过 `/api/agent/files` preview 创建 `tmp/a034-preview-only.txt` 的审批后可看到 `details.kind=file_mutation`；通过 `/api/agent/git` preview 创建 `codex/smoke-a034` 的审批后可看到 `details.kind=git_mutation` 和命令 `git branch codex/smoke-a034`。
- A034 安全验证：两个 smoke approval 已拒绝；`tmp/a034-preview-only.txt` 未创建；`codex/smoke-a034` 分支未创建。
- A035 已完成：新增 `/api/agent/approvals/execute`，只允许执行已批准且带有 `details` 的 approval；服务端从持久化 operation 发起文件/Git apply，前端不需要重新提交原始操作。
- A035 已接入持久化：ApprovalRecord 增加 `execution` 字段，记录执行成功/失败、执行时间、摘要、错误和压缩后的结果；页面刷新后仍能展示执行结果。
- A035 已接入前端：AgentPanel 中 `批准` 和 `执行` 是两个独立按钮；只有 approved 且未成功执行的 approval 会显示 `执行`；执行完成后展示成功/失败状态。
- A035 已修正：文件 mutation 的可选字段规范化不再保留 `undefined`，避免 preview 持久化后重新 apply 时 hash 不一致。
- A035 验证：`npm run lint` 通过，`npm run build` 通过；未批准 approval 调用 execute 返回 400；批准后文件 create approval 可二次点击执行并写入文件；成功执行后的重复 execute 返回 409。
- A035 安全验证：Git apply 只测试了低风险 branch 创建，不测试 commit/push；`codex/smoke-a035` 分支已删除；`tmp/a035-smoke-execute-2.txt` 临时文件已删除。
- A036 已完成：AgentPanel 默认模式从 `开发闭环` 改为 `Agent Loop`，避免用户默认进入不会自动生成改动的固定流程。
- A036 已完成：Agent Loop 新增 `file.replace.prepare` 工具，适合小型精确文本替换/删除；工具只创建 approval，不直接写文件。
- A036 已修正：Agent Loop 系统提示词明确要求代码修改类需求读取文件后调用 `file.replace.prepare` 或 `file.mutation.prepare` 生成审批。
- A036 已修正：SSE writer 增加关闭状态保护，避免客户端断开或 close 重入时抛 `Controller is already closed`。
- A036 兜底能力：对“首页 + 去掉/删除/移除某段文本”的请求，运行时会稳定准备 `src/app/page.tsx` 的文本删除 approval，不完全依赖模型是否选对工具。
- A036 验证：同样请求“把这个项目首页的 鹊桥 2个字去掉”会产生 `src/app/page.tsx` 的待审批 `Write file`，旧内容包含“鹊桥”，新内容不包含“鹊桥”；验证 approval 已拒绝，未实际修改首页代码。
- A036 验证：`npm run lint` 通过，`npm run build` 通过。
- A036 复测修正：用户实际点击执行后发现代码没变，原因是历史旧 approval 缺少 A034 的 `details`，前端容易误导用户。AgentPanel 现在会对 approved 但缺少 `details` 的旧审批显示“旧审批缺少可执行详情，请重新发起任务生成新的审批”。
- A036 复测验证：重新发起“把这个项目首页的 鹊桥 2个字去掉”后，生成新 approval 并执行成功，`src/app/page.tsx` 已移除“鹊桥”；`npm run lint` 和 `npm run build` 通过。
- A036 补充修正：普通 Agent Loop 分支里，模型通过 `file.mutation.prepare` / `file.replace.prepare` 等工具生成 approval 后，之前没有统一发出 `approval.required` 事件，导致审批可能已写入 `.agent-state/approvals.json`，但前端当次任务里看起来“没收到审批”。现已在 `src/agent/core/agent-loop.ts` 统一补发该事件。
- A036 前端体验修正：`AgentPanel` 现在会在 SSE 收到 `approval.required` 时立刻把新审批插入列表；审批列表改为 pending 优先、最新优先，并对当前任务生成的审批显示“本次任务”标记，避免历史审批淹没新审批。
- A036 通用编辑链路复测：实际发起“把 `src/app/page.tsx` 里的 `AI Chat × Vercel` 改成 `AI Chat × Codex`”后，任务 `task_5d5fcb28-3be8-48c1-994e-e50d4275622b` 成功生成新的 pending approval `approval_a1b0d906-1b13-4b8b-9a3a-4d1c0463c12c`，对应审批已写入 `.agent-state/approvals.json`，验证普通 Agent Loop 的非首页兜底改代码请求现在也能稳定产出审批。
- A037 已完成：新增 `src/components/agent-workspace.tsx`，首页改为全屏 Agent Workspace（活动流 + 变更审查双栏；聊天/预览为底部可折叠辅助面板）。
- A037 已完成：新增 `src/components/agent-event-timeline.tsx`，主路径用可读活动卡片展示 SSE 事件。
- A038 已完成：`ApprovalDetails` 增加 `patch_apply`；开发闭环 patch preview 持久化 diff；`/api/agent/approvals/execute` 支持 patch。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A039 已完成：`src/lib/line-diff.ts` + `src/components/diff-view.tsx` 为审批详情提供 +/- 行级 diff；`agent-event-timeline` 增加类型筛选与「调试 JSON」开关；Git commit/push 审批展示高风险横幅。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A040 已完成：`prepareGitMutation` 异步采集 `git status` / `git diff` / 当前分支 / push 的 remote URL，写入 `approval.details.preview.workspace`。
- A041 已完成：`src/agent/tools/shell-tools.ts`、`/api/agent/shell`、`shell.command.prepare`（Agent Loop）；`/api/agent/approvals/execute` 支持 `shell_command`；Push 执行需二次点击「确认 Push」。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A042 已完成：新增 `src/components/trace-panel.tsx`；Agent Workspace 顶部增加「历史」辅助面板，调用 `/api/agent/traces` 列表与详情，详情用 `AgentEventTimeline` 展示。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A043 已完成：`patch-tools` 支持 modify/create/delete/rename；`/dev/null` 路径；apply 时自动 mkdir、unlink、重命名写新删旧；含删除的 patch 审批风险升为 high。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A044 已完成：`src/components/diff-view.tsx` 默认 split（Before | After），可切换统一 diff；`agent-panel` 审批区使用 `layout="split"`。
- A044 已完成：`src/components/agent-event-timeline.tsx` 合并 `tool.started`+`tool.completed`、可折叠计划/反思/工具行、工具结果摘要与「已合并工具事件」开关。
- A045 已完成：`agent-loop-tools.ts` 新增 `patch.prepare`（调用 `applyUnifiedPatch` preview + approval）；`agent-loop.ts` 系统提示与 `agent-loop-state.ts` 反思检查点已纳入 patch 路径。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A046 已完成：`trace.linked` 事件关联 taskId/traceId；`agent-workspace-bridge` 连接主面板与 TracePanel；历史「恢复到主工作区」恢复活动流并筛选「仅本次任务」审批；`getTraceByTaskId` + `?taskId=` API。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A047 已完成：`src/components/patch-files-diff.tsx` 多文件 patch Tab；`line-diff.toSplitAlignedRows` + `DiffView` split 模式左右行号对齐。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A048 已完成：`patch-summary.ts`；活动流 patch 多文件摘要；审批区 Patch 原文默认折叠；`patch.prepare` 返回 `approval` 并走 `approval.required`。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A049 已完成：首页 `AgentWorkspace` 三栏 + 左侧图标栏（Agent/聊天/预览）；`AgentTraceSidebar`；`AgentPanel layout=triple`；活动流 `density=compact`。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A051 已完成：新增 `src/agent/memory/loop-context-compactor.ts`；每次 `provider.generate` 前按 token 预算压缩 messages（保留 system+用户任务+最近 12 条 tail）；中间历史先 `compressContext` 再可选模型语义 compact（`AGENT_LOOP_SEMANTIC_COMPACT=false` 可关）。
- A051 已完成：工具观测写入前按工具类型截断（`file.read`/`git.diff`/`file.search`/`project.index`）；活动流展示 `context.compacted` 及 token 估算。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A052 已完成：`loop-pinned-facts` 钉住审批/路径/分支/错误；多轮压缩合并 prior `[COMPACTED_MEMORY]`；`ChatCompletionsProvider.compact()`；`prepare` 类工具观测只保留 approvalId；右栏「任务记忆」+ 活动流可展开摘要。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A053 已完成：`context.compacted` 携带完整 `memoryContent`；`thread-memory-store` 跨 Task 持久化；`/api/agent/thread-memory`；Trace 详情与中栏 `AgentCompactedMemoryPanel`；Loop 支持 `threadId` + UI「延续会话记忆」/「新会话」。
- 验证：`npm run lint` 通过，`npm run build` 通过。
- A054 已完成：`agent-session-sidebar`（会话 + 任务双列表）；`GET /api/agent/threads`；`summaryPreview` 同步 thread-memory / trace.thread。
- A055 已完成：`thread-meta-store`；`PATCH/DELETE /api/agent/threads`；侧栏「继续 / 命名 / 删记忆」、预填 `lastUserRequest`。
- A056 已完成：内联重命名、记忆导出 `.md`、中栏记忆复制/导出；`AgentRunModeHint`（Loop vs 闭环说明，闭环后续不投入）。
- 验证：A054–A056 均 `npm run lint`、`npm run build` 通过。

## 接续收工（2026-05-29）

**阶段结论**：主链路已在真实外部 workspace（`aiproject`）跑通 **Loop → 审批 → 执行**；侧栏会话/项目管理与恢复 Trace 的体验 bug 已修。

**本批交付摘要**：

| 范围 | 内容 |
| --- | --- |
| Loop | 只读任务不误报缺审批；`validate:loop-state` |
| 侧栏 | 新会话、删会话、移除/恢复项目 |
| 恢复 Trace | 审批状态跟 `.agent-state/approvals.json`；输入框仅「继续」预填 |
| 试用 | `npm run validate:agent`；`node scripts/golden-path-trial.mjs "D:\案例\aiproject"` |

**本地状态目录（勿提交 git）**：`.agent-state/`（含 `workspace-sidebar.json`、`thread-meta.json` 的 `hidden`）、`.agent-traces/`。

**启动续作**：`npm run dev` → 设 workspace → 默认 Loop；删/藏侧栏项只改 UI 偏好，不动项目磁盘。

## 下一步建议（优先级）

1. **日常默认**：`.env.local` 已恢复语义压缩默认开启；dev 在 **3000** 运行；中栏关注「已执行 X 秒」总折叠即可跟踪 Agent 推理。
2. **可选**：需要更激进压缩时设 `AGENT_LOOP_MIDDLE_MSG_TRIGGER=3` 等（见 `.env.example`）。
3. **可选 UI**：点击路径跳转审查、工具步骤耗时细分、多轮折叠摘要一行化。
4. **暂缓**：文件树、编辑器、Electron、Chrome DevTools 深度读取、开发闭环增强。

## 今日收工（2026-05-27）

**阶段结论**：主链路已是 **Agent Loop + 审批执行 + Trace**；今日重点把 **Codex/Cursor 式上下文压缩与会话记忆**（A051–A056）接到 Loop 并可在 UI 使用。

**今日交付摘要**：

| 范围 | 内容 |
| --- | --- |
| 压缩 | `loop-context-compactor`、pinned facts、滚动 `[COMPACTED_MEMORY]`、`ModelProvider.compact` |
| 会话 | `thread-memory.json`、`thread-meta.json`、`/api/agent/threads`、左栏会话侧栏 |
| UI | 延续记忆 / 新会话 / 继续+预填 / 重命名 / 删记忆 / 导出 md / 记忆面板 |
| 说明 | 闭环（develop）不调用模型，日常只用 **Loop**；用户明确**不必再管闭环** |

**本地状态目录（勿提交 git）**：`.agent-state/`（approvals、thread-memory、thread-meta、browser 等）、`.agent-traces/`。

**启动续作**：`npm run dev` → 打开首页 Agent Workspace → 左栏选 workspace 路径 → 默认 **Loop** 输入任务。

## 明天建议接续（优先级）

1. ~~浏览器实机复测~~（2026-05-29 已做一轮，见 A064/A065）。
2. **对比实验**（可选）：`.env.local` 设 `AGENT_LOOP_SEMANTIC_COMPACT=false` 与默认各跑一轮，导出记忆 md 对比质量。
3. **暂缓**：开发闭环增强、左栏文件树、内嵌编辑器、Electron、Chrome DevTools 深度读取。

（以上条目已被上方「接续收工 2026-05-29」中的下一步建议取代，保留仅供对照。）

用户已明确：**暂不做**文件树与编辑器；**不必再投入**开发闭环（`/api/agent/develop` 可保留不动）。

### 后续不要忘记

- `npm run lint` 和 `npm run build` 已通过。
- A030 smoke 产生的 Git 测试 approval 已被拒绝，`codex/smoke-a030` 分支没有创建。
- A034 smoke 产生的文件/Git 测试 approval 已被拒绝，`tmp/a034-preview-only.txt` 未创建，`codex/smoke-a034` 分支没有创建。
- A035 smoke 产生的临时文件和测试分支已清理，`tmp/a035-smoke-execute-2.txt` 不存在，`codex/smoke-a035` 分支不存在。
- A036 首次验证 approval 已被拒绝；用户复测后重新生成并执行了新 approval，首页 `src/app/page.tsx` 已实际移除“鹊桥”。
- `.agent-state/` 和 `.agent-traces/` 是本地运行状态，不要提交。
- 当前 Web 内置浏览器只是 iframe 原型，会被外部站点 CSP/X-Frame-Options 限制；这不是明天第一优先级。
- 当前 Agent Loop 只允许 prepare 文件/Git 变更；真正 apply 仍需要用户在审批 UI 二次点击执行。

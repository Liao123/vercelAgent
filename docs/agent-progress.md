# 开发智能体项目进度

更新时间：2026-05-27

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
| A034 | todo | 审批详情快照 | Approval 记录能保存文件/Git 操作的结构化预览，前端可查看 diff、命令、风险和影响范围。 |
| A035 | todo | 审批后的执行闭环 | 用户批准后，前端能对已批准的文件/Git 操作发起 apply，并展示执行结果；仍禁止自动执行。 |

## 完成记录

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

## 当前下一步

明天从 A034 开始，不要先跳 Electron，也不要先做 Chrome DevTools 深度读取。

### 明天优先级

1. A034：补 Approval 详情数据模型。
   - 当前 approval 只保存 `title`、`reason`、`risk`、`action`、`status`，没有保存原始 operation 和 preview。
   - 需要给 ApprovalRecord 增加可持久化的详情字段，例如 `details` 或 `metadata`。
   - `/api/agent/files` preview 要把文件变更类型、路径、旧内容、新内容、大小变化等预览快照写进 approval。
   - `/api/agent/git` preview 要把 Git 操作类型、命令、目标分支、remote、风险 notes 等预览快照写进 approval。
   - 验收：刷新页面后，审批列表仍能展示这些详情，而不是只靠任务事件里的临时 JSON。

2. A034：增强 AgentPanel 审批详情展示。
   - 文件变更 approval 显示：操作类型、路径、旧/新内容摘要、简单 diff 或 before/after 对比。
   - Git approval 显示：将执行的命令、操作类型、branch/remote、风险提示。
   - 高风险操作用明显样式区分，但不要自动执行。
   - 验收：通过 `/api/agent/files` preview 创建审批后，页面能看到文件级详情；通过 `/api/agent/git` preview 创建审批后，页面能看到 Git 命令详情。

3. A035：再做审批后的 apply 闭环。
   - 当前前端只能批准/拒绝 approval，批准后还不能从 UI 发起真正 apply。
   - 因为 apply API 需要原始 operation，所以必须先完成 A034 的 operation/preview 持久化。
   - UI 上应区分 `批准` 和 `执行`：批准只是授权，执行必须再点一次，避免误操作。
   - 文件 apply 调 `/api/agent/files`，Git apply 调 `/api/agent/git`。
   - 验收：未批准不能执行；批准后用户二次点击才能执行；执行后展示成功/失败结果。

4. A035 安全边界。
   - 明天测试 Git apply 时优先测试低风险 branch 创建，不测试 commit/push。
   - 不允许 git commit、git push，除非用户明天重新明确授权。
   - 不允许安装依赖，不允许删除文件，不允许修改 `.env` 或密钥文件。
   - 文件测试优先用临时非敏感路径，并在执行前明确说明。

### 明天不要忘记

- `npm run lint` 和 `npm run build` 今天已通过。
- A030 smoke 产生的 Git 测试 approval 已被拒绝，`codex/smoke-a030` 分支没有创建。
- `.agent-state/` 和 `.agent-traces/` 是本地运行状态，不要提交。
- 当前 Web 内置浏览器只是 iframe 原型，会被外部站点 CSP/X-Frame-Options 限制；这不是明天第一优先级。
- 当前 Agent Loop 只允许 prepare 文件/Git 变更，不允许直接 apply。

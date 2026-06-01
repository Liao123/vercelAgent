# Agent Module Map

`src/agent` 是开发智能体核心骨架，短期先放在当前 Next.js 项目内，后续可以迁移到独立 agent-server 或 monorepo package。

## Directories

- `core/`：Agent 任务运行时，负责 Thread / Task / Turn / Plan / Event 的主流程。
- `browser/`：内置浏览器状态和 URL 打开入口，当前是 Web 预览壳，后续接 WebView/CDP。
- `indexer/`：项目索引，扫描页面、API route、组件、imports、exports 和业务关键词。
- `memory/`：上下文管理，负责把系统规则、项目规则、Thread/Task/Turn 信息整理成模型上下文。
- `model/`：模型供应商抽象层，现有聊天接口也从这里走。
- `protocol/`：前后端通信协议，目前是 SSE 事件流。
- `tools/`：本地工具层。只读工具可直接执行；文件变更和 Git 写操作必须走审批。
- `trace/`：任务 trace 记录，当前写入内存和 `.agent-traces/` 本地 JSON 文件。
- `verification/`：受控验证工具，只运行 package.json 中已有的白名单 npm scripts。
- `workspace/`：工作区识别，读取 Git、包管理器、框架和项目规则。
- `types.ts`：跨模块共享的核心类型。

## Local validation

```bash
npm run validate:agent
```

- `validate:compaction` — 长任务 head/tail 压缩与 pinned approval
- `validate:thread-memory` — Thread 跨 Task 记忆注入与二次压缩
- `validate:loop-state` — 只读任务不误触发改代码反思
- `validate:git-status` — 结构化 git.status
- `validate:content-snapshot` — 大文件 diff 行号对齐
- `validate:long-thread-compaction` — 跨 Task 多轮压缩

## UI（中栏推理）

- `src/lib/agent-turn-feed.ts` — 事件分组为 Turn；`narrativeEvents` / `detailEvents`
- `src/lib/agent-reasoning-steps.ts` — 反思+工具步骤分组与时长摘要
- `src/components/agent-turn-reasoning-timeline.tsx` — 总折叠推理时间线
- `src/lib/agent-tool-icons.tsx` — 工具步骤图标

## Current Boundary

当前已经允许：

- 读取 workspace 信息
- 读取项目规则
- 读取目录和文本文件
- 搜索文本
- 读取 Git status / diff
- 生成轻量项目索引
- 根据中文需求定位候选文件
- 运行受控验证命令：lint/build/test/typecheck
- 通过本地配置选择 workspace 路径
- 通过浏览器状态 API 打开 URL 并在 Web UI 中预览
- 创建任务事件流骨架
- 跑通最小开发闭环：定位文件、patch 预览/应用、验证、总结
- 持久化任务 trace 到本地 JSON 文件
- 生成分层上下文骨架
- 将多段上下文压缩为结构化摘要
- 按 token 预算筛选上下文并预留输出空间
- 预览 unified diff patch
- 在 approval 通过后应用 patch
- 预览并审批受控文件变更：create/write/delete/rename
- 预览并审批受控 Git 写操作：branch/commit/push
- 让 Agent Loop 准备文件变更和 Git 写操作 approval，但不直接执行

当前还不允许：

- 未经 approval 写文件
- 未经 approval 删除文件
- 安装依赖
- 执行任意 shell
- 未经 approval 执行 git branch / commit / push
- Chrome DevTools 深度读取

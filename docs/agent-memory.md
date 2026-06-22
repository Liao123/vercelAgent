# 开发智能体本地记忆

更新时间：2026-06-18

长期事实与架构决策。密钥勿写此处。接续见 [`agent-handoff.md`](agent-handoff.md)。

## 项目事实

- 仓库：`D:\案例\vec-next` · Next.js 16 + React 19 · Agent 骨架 `src/agent/`
- 模型：`ModelProvider` / `chat-completions-provider`；无独立聊天页
- 状态目录：`.agent-state/`（approvals、thread-memory 等）、`.agent-traces/`（勿提交 git）
- 主链路：Loop → 工具 → 审批 → execute → Trace/压缩

## 用户目标（不变）

Codex/Cursor 式开发智能体：中文需求 → 定位文件 → 改码 → 验证；内置浏览器；后期 Electron。

## 架构决策（摘要）

| ID | 决策 |
| --- | --- |
| D001 | 短期不大改结构，先在 `src/agent` 演进 |
| D002 | Runtime 与 UI 分离，可迁 agent-server |
| D003 | 浏览器长期走 CDP；深度读取分阶段 |
| D004 | 必须做上下文压缩与 token 预算 |
| D013–D015 | Loop 压缩 + pinned + thread 滚动记忆（A051–A053） |
| D016–D017 | 会话侧栏、重命名/删记忆/继续（A054–A055） |
| D018 | **开发闭环不再投入**；主 UI 仅 Agent Loop |
| D027–D032 | 中栏推理时间线、UI trace、准确度路线、prepare 门禁、消歧（A071–A076） |
| D033–D037 | prepare 证据、jsx/symbol、post-execute verify、@attach、黄金路径 validate |
| D038–D041 | 在线 UI 试用、recovery 过滤、prepare nudge、压缩钉住 hint |
| D042–D047 | post-execute 回灌 Loop、末轮 nudge、文件树、命令底栏授权、自动写盘、lint 再 Loop |
| D048 | **Shell 架构债**：非 Loop 内 Bash；prepare→批准→execute→续跑；P0 `trial:shell-recovery` |

细节已收敛：旧版逐条 A0xx 完成日志已删，以 git 与 `agent-progress.md` A106+ 为准。

## 用户偏好

- 中文沟通；先规划再干；文档要能接续
- 每完成重要项更新 `agent-handoff.md` + 台账
- 有 Chrome DevTools 提示词经验，可复用

## 当前约束

- 改 Next.js 前读 `node_modules/next/dist/docs/`（AGENTS.md）
- 命令 / git push 须用户批准；文件低中风险可自动写盘（`agent-defaults.md`）
- 改 Loop 内核后重启 dev
- 不引入 LangChain/LangGraph（暂不需要）
- 测试勿 commit/push/删真实文件/改 `.env`，除非用户明确授权

## 待补充

- 多 workspace 策略终局
- Electron 工作区选择器与 Web 路径粘贴的长期分工

# Agent 接续备忘

更新时间：2026-06-18

> 下次开工：**本文 → `npm run validate:agent` → 做 P0**。

---

## 接续收工（2026-06-18）

**现象**：「跑 dev」→ 批准 → 端口占用 / ANSI 乱码 → 像宕机（实为 Loop 结束 + 续跑只总结失败）。

**A141 已交付**：ANSI 清理；dev 长进程 ready 检测；聊天气泡内联批准；`assistant.notice`；失败续跑 recovery prompt；`approval-loop-continuation` 嵌套 result 解包。

**A141-follow 已交付**：`dev-run` playbook；`suggestAlternateDevPort`；`validate:shell-recovery`；在线 `trial:shell-recovery`（2026-06-18 实机 **PASSED**：失败后续跑 prepare `npm run dev -- --port 5175`）。

**架构债**：Claude/Cursor 的 Bash 在 Loop 内 `tool_result` 闭环；我们是 prepare → 批准 → execute → 再开 Loop。每条新命令仍要用户批准。

```bash
npm run validate:agent
npm run build
```

---

## P0 待办

| 项 | 说明 |
| --- | --- |
| ~~trial:shell-recovery~~ | ✅ 2026-06-18 实机 PASSED |
| **对标 Claude Bash** | 读 `claude-code` query.ts + Bash；Loop 内 tool_result 回灌（长期） |
| P2 PTY 终端 UI | 审批+执行已有，缺 xterm 面板 |

---

## 终端（A140 + A141）

- 工具：`shell.run.prepare` / `shell.command.prepare`
- UI：聊天气泡或底部 `AgentCommandApprovalBar` → 批准并运行
- 结果：`approval.executed` + 绿/红 `assistant.notice`
- 失败：`maybeResumeLoopAfterApproval` 续跑（prompt 含 recovery；仍须再批准新命令）

---

## 环境开关（常用）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `AGENT_LOOP_JSON_PROTOCOL=1` | 关 | 回退 JSON 协议 |
| `AGENT_EDIT_RECOVERY=1` | 关 | 磁盘 recovery |
| `AGENT_FINAL_PREPARE_NUDGE=1` | 关 | 末轮 prepare nudge |

完整列表见 `.env.example`。

---

## 关键路径

| 区域 | 路径 |
| --- | --- |
| Loop | `src/agent/core/agent-loop.ts` |
| Shell | `src/agent/tools/shell-runner.ts`, `shell-output.ts` |
| 命令审批 UI | `src/components/agent-panel.tsx`, `agent-turn-worked-line.tsx` |
| 批准后续跑 | `src/lib/approval-loop-continuation.ts` |
| 内核审计 | `docs/agent-kernel-audit.md` |
| 进度台账 | `docs/agent-progress.md` |

---

## 产品决策（不变）

- 日常自动写盘（低/中风险）；见 `agent-defaults.md`
- 命令 / Git push 须用户批准
- 改 Loop 内核后重启 `npm run dev` / `dev:desktop`

---

## 文档地图（精简后）

| 文档 | 用途 |
| --- | --- |
| **agent-handoff.md** | 接续入口（本文） |
| **agent-progress.md** | 工作项状态 |
| **agent-memory.md** | 架构决策 Dxxx |
| **agent-kernel-audit.md** | vs Claude Code / Cursor 内核对照 |
| **agent-architecture.md** | 长期架构参考 |
| **agent-defaults.md** | 产品默认策略 |
| **agent-electron.md** / **desktop-quickstart.md** | 桌面版 |
| **agent-accuracy-roadmap.md** | 改码准确度（A073+ 已 done，保留回归用例） |

已删除（内容过时或重复）：`agent-plan-next.md`、`agent-cursor-codex-gap.md`、`agent-kernel-gap-claude-code.md`、`agent-collapse-projection-spike.md`、`agent-compaction-benchmark.md`。

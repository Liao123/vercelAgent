# 开发智能体项目进度

更新时间：2026-06-18

> **接续入口**：[`agent-handoff.md`](agent-handoff.md)（收工摘要 + P0 待办）。  
> **架构决策**：[`agent-memory.md`](agent-memory.md)。  
> **历史**：A001–A105 已全部 done，细节见 git 历史，不再在此维护逐条完成记录。

## 状态说明

`todo` · `doing` · `blocked` · `done` · `deferred`

## 更新规则

1. 完成工作项 → 改状态为 `done`，并更新 `agent-handoff.md` 收工段（不必写长日志）。
2. 架构决策 → 写入 `agent-memory.md` 一条 Dxxx。
3. 勿写密钥；勿在聊天里只说完成不更新文档。

## 当前阶段

主链路：**Loop → 工具 → 审批（文件/命令）→ 执行 → Trace/压缩**。  
日常入口：`npm run validate:agent` + [`agent-handoff.md`](agent-handoff.md)。

## 近期工作项（A106+）

| ID | 状态 | 说明 |
| --- | --- | --- |
| A106 | done | 侧栏加号黄金路径 |
| A107 | done | 审查区文件联动 |
| A114–A121 | done | 原生 tool loop、外置大结果、压缩层、OpenAI tool 名 |
| A122–A124 | done | Composer 附图粘贴/拖放/气泡 |
| A125–A127 | done | 墓碑 stub、burst tail、压缩 UI |
| A128–A133 | done | 浏览器稳定性、Codex WebView、CDP、playbook、多标签 |
| A134–A136 | done | performance trace、design spec、design-replicate |
| A140 | done | Cursor 级终端：`shell.run.prepare`、策略、自举剧本 |
| A141 | done | 命令聊天气泡、失败续跑 recovery、ANSI、dev 长进程 |
| A141-follow | done | dev-run playbook、`validate:shell-recovery`、`trial:shell-recovery`、续跑 `--port` 建议 |
| A024 | in_progress | design-replicate 实机 |
| A025 | in_progress | Electron 壳 + 桌面浏览器 |

## 接续收工（2026-06-18）

**问题**：`npm run dev` 端口占用 + 输出乱码；Agent 续跑后只报失败不 retry。  
**交付**：A141（见 handoff）；`validate:shell-run`、`validate:approval-continuation`、`build` 通过。  
**下次**：长期 Claude Bash in-loop（架构级）；可选 P2 PTY 终端 UI。

```bash
npm run validate:agent && npm run build
```

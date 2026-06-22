# 开发智能体项目进度

更新时间：2026-06-22

> **接续入口**：[`agent-handoff.md`](agent-handoff.md)（收工摘要 + P0 待办）。  
> **通用能力方案**：[`agent-generic-capability-roadmap.md`](agent-generic-capability-roadmap.md)（A147+ 逐步实施；**每次改动先过通用思考清单**）。  
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
| A142 | done | 会话续聊：任务结束写 thread memory |
| A143 | done | uiContext 注入（浏览器标签等，中性描述、不硬绑句式） |
| A144 | done | 通用推理轮 `[TASK_REASONING]` + 证据门槛 gate；移除 browser-live / conversation-recall 硬路由 |
| A145 | done | 记忆≠证据 normalize、final 取证 gate、meta 思考过程展开、窄 QA 拦截重复 index、减少 reflection 刷屏 |
| A146 | done | 窄 metadata QA 提速 gate（禁多余 browser/list/read）；trial:site-title-qa ~31s×3 工具 |
| A147 | done | Workspace 快照零成本注入（`workspace-snapshot-prompt` + system/推理轮） |
| A148 | done | 证据充分通用收口：`isTaskEvidenceSufficient` + `taskEvidenceComplete` + gather 拦截 |
| A149 | done | 单轮并行 gather：`parallel-gather.ts` + `Promise.all`；`AGENT_LOOP_PARALLEL_GATHER=0` 可关 |
| A150 | done | 自适应推理轮：`evaluateReasoningTurn` full/skip/off；`AGENT_LOOP_ADAPTIVE_REASONING=0` 可关 |
| A151 | done | Shell in-loop 续跑：checkpoint + `shellResume` + `task.awaiting_approval` |
| A152 | done | 通用 read-only QA trial：`trial:readonly-qa`（路径指标，不断言答案） |
| A153 | done | Framework metadata catalog；gate 去 layout/index 硬编码 |
| A154 | done | Model resilience + `validate:generic-capability` |
| A155 | done | UI 叙事瘦身：`isNoisyRuntimeReflection` |
| A156 | done | `trial:capability-matrix` 多 intent 回归 |
| A157 | done | 压缩/记忆 pin `[TASK_REASONING_PIN]` |
| A158 | done | Project index 会话缓存 + scoped `query`；`validate:project-index` |
| A159 | done | Shell 输出分层策略（already/port/timeout/generic）+ 续跑提示接入 |
| A024 | done | `trial:design-replicate` 实机通过；playbook 写盘前强制 extract spec |
| A025 | done | Electron 壳 + CDP 浏览器 + 打包链路；`validate:desktop-smoke` |

## 接续收工（2026-06-22）

**问题**：会话第二条消息丢失上文；简单「网站标题」问题多轮搜仓库约 20s；凭记忆作答、meta 拒答「不展开隐藏推理」。  
**交付**：A142–A143（thread memory + uiContext）；A144（推理轮 + 证据 gate）；A145（记忆≠证据、final gate、meta 展开、提速）。  
**验证**：`npm run validate:loop-reasoning` · `validate:session-continuity`

```bash
npm run validate:agent && npm run build
```

## 接续收工（2026-06-18）

**问题**：`npm run dev` 端口占用 + 输出乱码；Agent 续跑后只报失败不 retry。  
**交付**：A141（见 handoff）；`validate:shell-run`、`validate:approval-continuation`、`build` 通过。  
**下次**：长期 Claude Bash in-loop（架构级）；可选 P2 PTY 终端 UI。

```bash
npm run validate:agent && npm run build
```

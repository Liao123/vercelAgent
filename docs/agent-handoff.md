# Agent 接续备忘

更新时间：2026-06-22

> 下次开工：**本文** → **A164**（`workspace-grounding` 去词表化，见下）→ `npm run validate:agent`。改 Loop 后重启 dev。

---

## 待办（下次优先 · A164）

**目标**：A163 咨询类 gate 豁免再通用化——少维护中英文词表，主靠推理结构化字段。

| 项 | 说明 |
| --- | --- |
| **主路径** | `evidenceNeeded` 为空且 `planSteps`/`plannedNext` 无 gather 工具名 → `evaluateFinalEvidenceGate` 不拦 final |
| **推理 schema** | 可选新增 `intent: advisory \| generative`（或 `grounding: workspace \| none`），gate 只认字段 |
| **词表瘦身** | `isWorkspaceGroundedUserRequest` 负向词表逐步删，仅保留路径/扩展名等硬信号作兜底 |
| **回归** | `validate:loop-reasoning` 增商业/法律/写码三例；可选 `trial:advisory-qa`（路径指标：无 gather 可 final） |
| **锚点** | `src/agent/core/workspace-grounding.ts`、`evidence-gate.ts`、`loop-reasoning.ts` |

**现状（A163，已交付）**：词表 + `reasoningRequiresWorkspaceGather` 双层；够用但有领域词维护债。详见 [`agent-generic-capability-roadmap.md`](agent-generic-capability-roadmap.md) **A164**、**D054**。

---

## 接续收工（2026-06-22 · A163 咨询类任务证据 gate）

**现象**：产品/商业规划类长问句被标成 `qa+read_only` → final 被拦「须 file.read」；偶发误 `npm run dev`。

**交付**：`workspace-grounding.ts` 区分 workspace 取证 vs 生成类任务；`evaluateFinalEvidenceGate` / `normalizeTaskReasoning` 仅对 grounded 任务强制 gather；`dev-run` playbook 不对咨询类问句触发。

```bash
npm run validate:loop-reasoning
```

---

## 接续收工（2026-06-22 · A162 失效 Workspace 路径）

**现象**：`.agent-state/workspace.json` 指向已删除目录（如 `d:\案例\ai项目\zyxm`）→ `GET /api/agent/workspace` 500（`project-rules` `ENOENT`）。

**交付**：`resolveWorkspaceRootPath` 失效回退 `process.cwd()` + `staleConfiguredPath` 提示；`project-rules` 防御性 `readdir`；面板提示重新选文件夹。

```bash
npm run validate:workspace-stale-path
npm run validate:agent
```

**用户操作**：Composer 左下角重新选择工作区文件夹，或 POST `/api/agent/workspace` 写入新 `rootPath`。

---

## 接续收工（2026-06-22 · A161 低风控 shell 自动运行）

**交付**：Composer ⚙「低风控命令自动运行」（默认关）；`validate:*` / lint / test / `git status` 等 `risk=low` 可免点批准；dev/build/install 仍须手动批准。`validate:shell-auto-approve`。

```bash
npm run validate:shell-auto-approve
npm run validate:command-approval-ui
```

---

## 接续收工（2026-06-22 · A160 命令底栏）

**交付**：`AgentCommandApprovalBar` 固定在输入框上方；待运行 shell 命令可底栏或聊天气泡「批准并运行」；`validate:command-approval-ui` 纳入 `validate:agent`。顺带修复 `loop/route.ts` `shellResume.completedAt` 类型归一化。

```bash
npm run validate:command-approval-ui
npm run validate:agent && npm run build
```

---

## 接续收工（2026-06-22 · A158 语义索引）

**交付**：`getOrBuildProjectIndex` 会话缓存；`project.index(query)` scoped 检索；gate 仅拦重复全量 index；`validate:project-index`。

```bash
npm run validate:project-index
npm run validate:loop-reasoning
```

---

## 接续收工（2026-06-22 · A024/A025）

**A024**：新增 `trial:design-replicate`（playbook + browser + design spec + file.read 路径指标，不断言页面文案）。实机验收 `/demo-replicate`：HTTP 200 + 可见 `Example Domain` / 说明文案 / 链接，灰底白卡片布局与 example.com 一致。

**A025**：桌面壳离线冒烟 `validate:desktop-smoke`；electron/pack/browser-desktop/desktop-setup 验证通过。

```bash
npm run validate:demo-replicate-page
npm run validate:desktop-smoke
npm run validate:design-replicate
npm run trial:design-replicate   # 需 dev
# 浏览器打开 http://localhost:3000/demo-replicate
```

---

## 接续收工（2026-06-22 · A159 Shell 策略分层）

**交付**：新增 `classifyShellRecoveryPlan`（already_satisfied / port_conflict / timeout_or_no_output / generic_failure）；`approval-loop-continuation` 改为消费分层策略；`dev-run` playbook 与 native prompt 改为按输出分层，不再绑定 Next.js/3000 句式。

```bash
npm run validate:shell-recovery
```

---

## 接续收工（2026-06-22 · A153–A157 通用主义第二轮）

**交付**：metadata catalog 替代 gate 内路径正则；runtime 日历事实注入；模型 524 清洗+重试；时间线过滤噪音 reflection；trial 矩阵；压缩钉住 taskReasoning。

```bash
npm run validate:generic-capability
npm run validate:loop-reasoning
npm run trial:capability-matrix   # 需 dev
```

---

## 接续收工（2026-06-22 · A151）

**交付**：`shell.run.prepare` 后 Loop 暂停并保存 checkpoint；用户批准后同 thread 注入 `[SHELL_EXECUTED]` 续跑（保留 messages 上下文，非新开 Loop）；无 checkpoint 时回退 Phase A 文本续跑。`AGENT_LOOP_SHELL_RESUME=0` 可关。

```bash
npm run validate:shell-loop-resume
npm run validate:approval-continuation
```

---

## 接续收工（2026-06-22 · A150 + A152）

**交付**：低风控只读 / 会话 follow-up 跳过 JSON 推理轮，改注入 `[REASONING_SKIPPED]` hint（首轮歧义 QA 仍走 full reasoning）；`AGENT_LOOP_ADAPTIVE_REASONING=0` 可关。通用只读 trial `trial:readonly-qa`（路径指标，不断言答案字符串）。

```bash
npm run validate:loop-reasoning
npm run trial:readonly-qa   # 需 dev
```

---

## 接续收工（2026-06-22 · A149）

**交付**：原生 loop 同一轮多个 gather `tool_calls` 可 `Promise.all` 并行；`canParallelizeGatherBatch` 边界（只读、非 browser、file.read 路径不重复）；`validate:parallel-gather`。

```bash
npm run validate:parallel-gather
```

---

## 接续收工（2026-06-22 · A148）

**交付**：`isTaskEvidenceSufficient`（`evidenceNeeded` 空 + 已 gather）；`taskEvidenceComplete` 通用收口；拦截后续 gather 时 `proceedToFinal` 软引导 + user nudge。

```bash
npm run validate:loop-reasoning
```

---

## 接续收工（2026-06-22 · A147）

**交付**：Workspace 快照（framework / packageName / packageManager）注入 system prompt 与 `[TASK_REASONING]` 上下文；无需先调 `workspace.inspect` 获知技术栈。

```bash
npm run validate:workspace-snapshot
npm run validate:loop-reasoning
```

---

## 接续收工（2026-06-22）

**现象**：同一会话第二条消息「忘记」上文；「网站标题」类简单问题走 4 轮 `project.index` + 读文件，约 20s。

**A142–A143 已交付**：thread memory 任务结束落盘；uiContext 透传；浏览器标签作中性上下文。

**A144 已交付**：首轮模型 JSON 推理（intent/证据/计划/歧义）；证据 gate（写盘前须 file.read）；Playbook 仅作 accelerator hint；删除「网站标题→browser」等硬编码规则。

**A145 已交付**：`normalizeTaskReasoning`（记忆≠证据，禁止仅凭 thread memory final）；`evaluateFinalEvidenceGate`（只读事实类须本轮取证）；`isMetaExplainRequest`（思考过程须分点展开）；窄 QA 拦截重复 `project.index`；减少无意义 runtime reflection 刷屏。

**A146 已交付**：窄 metadata QA 提速 gate（layout 已读则禁 browser.*；locate 后禁 file.list；layout+package 已读则禁继续 file.read）；推理 plan 注入最短路径；`npm run trial:site-title-qa` 实机 ~31s / 3 工具。

```bash
npm run trial:site-title-qa
npm run validate:loop-reasoning
npm run validate:session-continuity
npm run validate:agent && npm run build
```

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
| **A164** | **下次优先**：`workspace-grounding` 去词表化（见文首待办 + roadmap） |
| ~~trial:shell-recovery~~ | ✅ 2026-06-18 实机 PASSED |
| ~~A147–A159~~ | ✅ done |
| **对标 Claude Bash** | Loop 内 tool_result 真闭环（A151 已 Phase B，长期） |
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
| `AGENT_LOOP_SKIP_REASONING=1` | 关 | 关闭首轮 JSON 推理轮 |
| `AGENT_LOOP_ADAPTIVE_REASONING=0` | 开 | 关闭自适应跳过推理 |
| `AGENT_LOOP_PARALLEL_GATHER=0` | 开 | 关闭单轮并行 gather |
| `AGENT_LOOP_SHELL_RESUME=0` | 开 | 关闭 shell 同 Loop 续跑 |
| `AGENT_MODEL_RETRY=0` | 开 | 关闭模型 API 退避重试 |

完整列表见 `.env.example`。

---

## 关键路径

| 区域 | 路径 |
| --- | --- |
| Loop | `src/agent/core/agent-loop.ts` |
| **Grounding / 证据 gate** | `workspace-grounding.ts`, `evidence-gate.ts`（A164 待去词表） |
| Shell | `src/agent/tools/shell-runner.ts`, `shell-output.ts` |
| 命令审批 UI | `src/components/agent-panel.tsx`, `agent-turn-worked-line.tsx` |
| 批准后续跑 | `src/lib/approval-loop-continuation.ts` |
| 内核审计 | `docs/agent-kernel-audit.md` |
| **通用能力路线图** | `docs/agent-generic-capability-roadmap.md` |
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

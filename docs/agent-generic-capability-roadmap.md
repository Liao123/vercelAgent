# Agent 通用能力路线图

更新时间：2026-06-22

> **用途**：记录「能力与速度」方向的**通用**改造方案，按项逐步实施。  
> **接续**：每完成一项 → 更新本文状态 + [`agent-progress.md`](agent-progress.md) + [`agent-handoff.md`](agent-handoff.md)。  
> **决策索引**：通用优先原则见 [`agent-memory.md`](agent-memory.md) **D049**。

---

## 每次思考必读：通用优先

做任何 Agent 内核/UI/验证改动前，先过一遍下面清单。**默认答案应是「用通用机制解决一类问题」，而不是「为某句中文或某个仓库写死路径」。**

### 通用思考检查清单

| # | 自问 | 通过标准 |
| --- | --- | --- |
| 1 | 这是在修**一类**问题，还是**一个** demo 问法？ | 能举出 ≥2 个不同措辞/不同技术栈的同类场景 |
| 2 | 规则管什么、模型管什么？ | 规则只定**边界**（能否 final、是否读过盘、是否允许写）；**意图与工具选择**交给推理 + 上下文 |
| 3 | 有没有中文/英文句式 → 工具名的硬映射？ | 禁止；Playbook 只能是 **accelerator hint** |
| 4 | 新逻辑能否用**结构化信号**表达？ | 优先 `TaskReasoning` 字段、`risk`、`evidenceNeeded`、`uiContext`、`workspace` 元数据 |
| 5 | 记忆算不算证据？ | Thread memory / 上轮结论 = **线索**；事实类回答仍要本轮 gather（除非 meta 解释） |
| 6 | 提速是否靠减轮次，而非减思考？ | 并行工具、零成本上下文注入、证据齐收口；不是跳过歧义分解 |
| 7 | 如何回归？ | 指标用 **tool 路径 / 耗时 / gate 行为**，不用「答案必须是某字符串」绑死仓库 |
| 8 | 写文档了吗？ | 方案、状态、验证命令写进本文与 handoff |

### 反模式（禁止）

- 「网站标题 → 必须 browser.inspect / 必须 layout.tsx」
- 「会话追问 → conversation-recall playbook 强制路由」
- 「Vue 项目 → 写死 index.html；Next 项目 → 写死 layout.tsx」
- 用红色 `error` 表示「该 final 了」的**引导**（应 `proceedToFinal` 软收口）
- 为通过 trial 而写死 ground truth 字符串（trial 只量路径）

### 推荐模式（保持）

```text
用户请求
  → [TASK_REASONING]（歧义 / intent / evidenceNeeded / planSteps）
  → runtime 修正（normalizeTaskReasoning：记忆≠证据、meta 展开）
  → gather（模型选工具；gate 拦截重复/无效/已充分）
  → final（evaluateFinalEvidenceGate）
  → thread memory 落盘
```

---

## 已交付基础（A142–A146）

| ID | 能力 | 文件锚点 |
| --- | --- | --- |
| A142 | 任务结束写 thread memory | `loop-context-compactor.ts`, `agent-loop.ts` |
| A143 | uiContext 中性注入 | `agent-panel.tsx`, `loop/route.ts`, `ui-layout-boost.ts` |
| A144 | 首轮 JSON 推理轮 | `loop-reasoning.ts` |
| A145 | 记忆≠证据、final gate、meta 展开 | `loop-reasoning.ts`, `evidence-gate.ts` |
| A146 | gather 提速 gate、`proceedToFinal` | `evidence-gate.ts`, `agent-loop-tool-runner.ts` |
| A146-follow | `index.html` 误判 layout 已读、引导不当报错 | `evidence-gate.ts`（`hasLayoutMetadataEvidence`） |

**实机参考**：`baidu-homepage-vue3` 读 `index.html` 标题正确；`vec-next` 读 `layout.tsx` 正确——**同一套机制，不同仓库由模型 + workspace 上下文决定路径**。

---

## 路线图总览

| ID | 状态 | 标题 | 优先级 | 预期收益 |
| --- | --- | --- | --- | --- |
| **A147** | `done` | Workspace 快照零成本注入 | P0 | 少 1 轮工具；框架感知不靠猜 |
| **A148** | `done` | 证据充分通用收口（`isTaskEvidenceSufficient` + `taskEvidenceComplete`） |
| **A149** | `done` | 单轮并行 gather（`Promise.all` + `canParallelizeGatherBatch`） |
| **A150** | `done` | 自适应推理轮 | P1 | 简单只读少 1 次 LLM |
| **A151** | `done` | Shell in-loop `tool_result` | P1 | 命令链不断裂；对标 Cursor Bash |
| **A152** | `done` | 通用 trial 套件（路径指标） | P2 | 可回归的速度/能力基线 |
| **A153** | `done` | Framework metadata catalog + gate 去路径硬编码 | P0 | 多技术栈 metadata QA |
| **A154** | `done` | Model resilience（重试/错误清洗/import smoke） | P0 | 524 等不再刷屏 |
| **A155** | `done` | UI 叙事瘦身（noisy runtime reflection 过滤） | P1 | 时间线可读 |
| **A156** | `done` | Trial 矩阵 `trial:capability-matrix` | P1 | 多 intent 回归 |
| **A157** | `done` | 压缩/记忆 pin `taskReasoning` | P2 | 长线程不失意图 |
| **A158** | `done` | 语义索引提质（缓存 + scoped query） | P1 | 少重复全量 walk |
| **A159** | `done` | Shell 策略分层（输出分类 + 续跑指令） | P1 | 失败续跑更稳，不绑 Next 句式 |

**建议实施顺序（A153+）**：A154 → A153 → A155 → A156 → A157 → A158 → A159。

---

## A147 — Workspace 快照零成本注入

**问题**：模型常先调 `workspace.inspect` 才知道 Vue / Next / 包名，浪费一轮。

**通用方案**（不写死问法）：

- Loop 启动时读取已有 `WorkspaceInfo`（`workspace-manager.ts`），注入 system 或首条 context：
  - `framework`, `packageName`, `packageManager`, `rootPath`
- 文案中性：`Runtime workspace snapshot (facts, not proof for edits)`。

**不做**：根据 framework 强制工具链。

**完成标准**：

- [x] `createLoopSystemPrompt` 或 loop 首条 message 含 snapshot
- [x] `validate:workspace-snapshot` 离线断言字段存在
- [ ] 实机：只读问句未调用 `workspace.inspect` 也能选对 metadata 文件类型（可选 trial 观测）

**关键路径**：`create-loop-system-prompt.ts`, `agent-loop.ts`, `workspace-manager.ts`

---

## A148 — 证据充分通用收口

**问题**：A146 `narrowQaEvidenceComplete` 偏 metadata；证据齐后模型仍可能继续 gather。

**通用方案**：

- 抽象 `isTaskEvidenceSufficient(state)`：
  - `taskReasoning.evidenceNeeded` 为空（或 runtime 判定已满足）
  - 本轮已有 gather 工具
  - `risk === read_only` 且非 `code_edit`
- 满足时：`narrowQaEvidenceComplete` 泛化为 `taskEvidenceComplete`
- 拦截**所有** `GATHER_EVIDENCE_TOOLS` → `proceedToFinal`（软引导 + user nudge）
- **不**绑定 layout / index / 标题等词。

**完成标准**：

- [x] `evidence-gate.ts` 导出通用 sufficient 判定
- [x] `validate-loop-reasoning` 覆盖
- [x] `taskEvidenceComplete` 替代 `narrowQaEvidenceComplete`；`proceedToFinal` 软引导

**关键路径**：`evidence-gate.ts`, `agent-loop-tool-runner.ts`, `agent-loop-state.ts`

---

## A149 — 单轮并行 gather

**问题**：内核每 iteration 常只执行一个工具；`file.read` ×2 串行占 2 轮 LLM。

**通用方案**：

- 原生 tool loop 已支持多 `tool_calls`：一轮内执行**独立** gather（如多个 `file.read` 不同路径）
- Gate 对每个 call 独立评估；写盘类仍串行+须先 read

**不做**：按问题类型规定「必须并行读哪两个文件」。

**完成标准**：

- [x] `agent-loop.ts` 一轮处理多 tool_call（并行 gather）
- [x] `validate:parallel-gather`
- [ ] trial 对比 iteration 数下降（可选）

**关键路径**：`agent-loop.ts`, `agent-loop-tool-runner.ts`

---

## A150 — 自适应推理轮

**问题**：简单只读也走完整 `[TASK_REASONING]`，+5–15s。

**通用方案**（信号来自推理/schema，非用户句式）：

- `shouldRunReasoningTurn` / `evaluateReasoningTurn`：env `AGENT_LOOP_ADAPTIVE_REASONING=0` 可关（**默认开**）
- **仍跑完整推理** 若：首轮歧义 QA、edit、meta explain、复杂多步、附图无文字
- **跳过 JSON 推理轮**（注入 `[REASONING_SKIPPED]` hint）若：显式只读、或有 THREAD_MEMORY 的会话 follow-up

**不做**：「少于 N 个汉字就跳过推理」。

**完成标准**：

- [x] env 文档进 `.env.example`
- [x] 跳过时不丢歧义提示（`buildAdaptiveReasoningSkipHint`）
- [ ] trial 对比耗时，能力回归不退化（`trial:site-title-qa` 仍走 full reasoning）

**关键路径**：`loop-reasoning.ts`, `agent-loop.ts`

---

## A151 — Shell in-loop `tool_result`

**问题**：prepare → 批准 → execute → **新 Loop**；上下文断、每条命令再批准。

**通用方案**（分阶段）：

1. **Phase A**：批准后同 thread 自动续跑，stdout 作为 user/tool 消息注入（`approval-loop-continuation`，无 checkpoint 时回退路径）
2. **Phase B**：`shell.run.prepare` 后 Loop 暂停 + checkpoint；批准后 `shellResume` 同上下文续跑（`task.awaiting_approval` → `[SHELL_EXECUTED]` 注入）
3. 审批边界不变：写命令仍须用户批

**完成标准**：

- [x] checkpoint 存取 + `validate:shell-loop-resume`
- [x] panel 优先 `shellResume` API
- [x] env `AGENT_LOOP_SHELL_RESUME=0` 可关
- [ ] 实机 trial：prepare → 批准 → 续跑不丢上下文（`trial:shell-recovery` 可复用）

**关键路径**：`shell-runner.ts`, `approval-loop-continuation.ts`, `agent-loop-tools.ts`

---

## A152 — 通用 trial 套件

**问题**：`trial:site-title-qa` 是单点；需要按 **intent** 度量，不绑仓库答案。

**通用方案**：

- `scripts/trial-readonly-qa.mjs`：参数化 `userRequest`，断言：
  - `toolCount` ≤ 阈值（宽松）
  - `noRepeatedIndex`
  - `hasGatherBeforeFinal`
  - `completed`
  - **不断言** 具体标题字符串
- 报告：`.agent-state/compare/readonly-qa-trial.json`
- 可选多 workspace 路径参数

**完成标准**：

- [x] `npm run trial:readonly-qa`
- [x] handoff 收工可引用

---

## A153 — Framework metadata catalog

**问题**：`evidence-gate` 内 `layout.tsx` / `index.html` 正则属于技术栈知识，难扩展 Astro/Nuxt。

**方案**：

- `framework-metadata-catalog.ts`：`page_title` / `package_name` 角色 + framework profile
- `runState.workspaceFramework` 来自 snapshot
- Gate / normalize 只认 role，不认用户句式

**关键路径**：`framework-metadata-catalog.ts`, `evidence-gate.ts`, `loop-reasoning.ts`

---

## A154 — Model resilience

**问题**：524 HTML 进 blocker；偶发 `ReferenceError` 误报模型不可用。

**方案**：

- `model-error-message.ts` + `model-call-resilience.ts`
- `loop-model-generate` 对 524/502 退避重试
- `validate:generic-capability` 断言 provider import

**env**：`AGENT_MODEL_RETRY=0` / `AGENT_MODEL_RETRY_MAX`

---

## A155 — UI 叙事瘦身

**问题**：「第 N 轮」runtime reflection 刷屏。

**方案**：`isNoisyRuntimeReflection` — 进度类反思合并进步骤，保留模型失败等关键 blocker。

---

## A156 — Trial 矩阵

```bash
npm run trial:capability-matrix
```

只读 / metadata QA / 日历类三场景，路径指标，不断言答案。

---

## A157 — Pin taskReasoning

压缩与 thread memory 写入 `[TASK_REASONING_PIN]`（intent/risk/evidence），长线程续聊不失歧义计划。

---

## A158 — 语义索引提质

**问题**：`project.index` 每次全量 walk；窄只读 QA 易反复全量索引空转。

**通用方案**：

- 会话级 `getOrBuildProjectIndex`（`AGENT_PROJECT_INDEX_CACHE_TTL_MS`，默认 5 分钟）
- `project.index` 可选 `query` → `searchProjectIndex`（文件候选 + 路由/API 命中）
- `file.locate` / `symbol.find_references` 共用 `context.projectIndex` + 缓存
- Gate：窄 QA **重复全量** index 仍拦截；带 `query` 的 scoped 调用放行
- `isExplorationGatherIntent`：由 `TaskReasoning.intent` / `evidenceNeeded` 判定探索类 gather

**完成标准**：

- [x] `project-index-cache.ts` + `project-index-search.ts`
- [x] `validate:project-index`
- [x] prompt 中性说明 overview vs scoped query

---

## A159 — Shell 策略分层

**问题**：shell 失败恢复文案耦合 Next/3000；不同失败类型（已在运行 / 端口冲突 / 超时 / 脚本错）没有统一策略层。

**通用方案**：

- 新增 `classifyShellRecoveryPlan`：输出按 tier 分类
- `approval-loop-continuation` 只消费结构化分类，不写死框架词
- `dev-run` playbook 与 prompt 改为“按输出分层处理”，不绑特定句式
- `validate:shell-recovery` 覆盖 tier 行为（already_satisfied / port_conflict / timeout）

**完成标准**：

- [x] `shell-strategy.ts` 分类器
- [x] `approval-loop-continuation.ts` 接入分层恢复
- [x] `validate:shell-recovery` 新断言通过

---

## 实施节奏（建议）

| 周次 | 项 | 产出 |
| --- | --- | --- |
| 1 | A147 + A148 | 注入 snapshot；通用 evidence complete |
| 2 | A149 + 度量 | 并行 gather；更新 trial 指标 |
| 3 | A150 | 自适应推理 + env |
| 4+ | A151 / A152 | Shell 闭环 Phase；trial 套件 |

每完成一项：

1. 本文表格状态 → `done`
2. `agent-progress.md` 同步
3. `agent-handoff.md` 收工 3–5 行
4. 若原则性决策 → `agent-memory.md` Dxxx

---

## 验证命令（通用能力相关）

```bash
npm run validate:loop-reasoning
npm run validate:session-continuity
npm run validate:agent
npm run trial:site-title-qa      # 单点样例（首轮歧义 QA，仍走 full reasoning）
npm run validate:generic-capability
npm run validate:project-index
npm run trial:capability-matrix   # 需 dev
```

---

## 文档地图

| 文档 | 关系 |
| --- | --- |
| **本文** | 通用能力方案与实施台账 |
| [`agent-handoff.md`](agent-handoff.md) | 接续入口、收工摘要 |
| [`agent-progress.md`](agent-progress.md) | A147+ 状态 |
| [`agent-kernel-audit.md`](agent-kernel-audit.md) | vs Claude/Cursor 差距 |
| [`agent-memory.md`](agent-memory.md) | D049 通用优先原则 |

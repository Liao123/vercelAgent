# 开发准确度路线图（Cursor / Codex 对照）

更新时间：2026-06-01

本文档记录 vec-next Agent 与 **Cursor / Codex** 在「改对文件、改对内容」上的差距，以及后续工作项（A073+）的优先级与验收标准。架构决策见 [`agent-memory.md`](agent-memory.md) D029；工作项状态见 [`agent-progress.md`](agent-progress.md)。

---

## 1. 结论摘要

Cursor/Codex 的高准确度主要来自 **IDE 态上下文 + 符号级索引 + 改前/改后验证**；vec-next 当前依赖 **自然语言 + 关键词搜索 + 模型自觉**。A072 已补上「从 page 沿 import 追组件树」，但仍缺：

- 运行时布局感知（triple vs default）
- prepare 硬门禁（无 read 证据禁止改）
- 轻量符号/JSX 引用
- 改后 lint/build 回灌
- 用户 @ 文件 / 选区上下文

在 **审批写盘** 产品约束下，准确度应优先 invest **改前证据链**，而非单纯增加 reflect 轮次。

---

## 2. 维度对照

| 维度 | Cursor | Codex | vec-next（A072 后） | 影响 |
| --- | --- | --- | --- | --- |
| 用户指向 | `@file`、选区、打开 Tab | IDE 上下文 | 仅 `userRequest` + 附图 + Thread 记忆 | 高 |
| 布局/运行时态 | 当前页面、预览 | 工作区上下文 | 未知 `layout="triple"` 等 | 高 |
| 定位 | 语义索引 + LSP + ripgrep | 强 codebase + 搜索 | 关键词 + search + import 树 | 中高 |
| 改前约束 | 常带 exact diff / 选区 | read→edit 工具序 | 仅 system prompt，**无硬门禁** | 高 |
| 改后验证 | lint/tsc/test 回灌 | 自动跑命令自修 | 有 shell.prepare，Loop **不强制** | 中高 |
| UI 确认 | Browser/DOM（部分） | 预览 | iframe，**无 DOM 查询** | 中 |
| 引用关系 | Find references | 符号图 | 仅 import 树，**无反向 usage** | 中 |
| 压缩 | 文件 pin | 结构化摘要 | compaction + pinned approval | 中 |
| 兜底恢复 | 多轮 self-correction | 同左 | `edit-recovery` 仅删除类 | 中 |

---

## 3. 已接近 Cursor/Codex 的部分

- Reflect → Tool → Prepare 循环 + 中栏推理时间线（A071）
- 审批再写盘（更保守，压力在「先定位对」）
- A072：`ui.trace_from_page` + UI 意图加权 + `@/` 解析
- `file.replace.prepare` 必须 exact match（防瞎编）
- Thread 记忆 + 长任务压缩（A068）

---

## 4. 工作项与优先级

对应 [`agent-progress.md`](agent-progress.md) 工作项 A073–A080。

### P0 — 减少改错文件 / 改错布局

| ID | 工作项 | 验收标准 |
| --- | --- | --- |
| **A073** | Loop 注入 UI 运行时上下文 | `/api/agent/loop` 接收 `uiContext: { layout, activeRoute }`；前端 triple 布局传入；`file.locate` / trace 加权：triple→`agent-composer`，default→`agent-panel`；system prompt 注入 layout 说明 |
| **A074** | prepare 硬门禁 | `file.replace.prepare` / `file.mutation.prepare` / `patch.prepare`：目标 path 须在 `filesRead`；UI 意图且未 trace/locate 时拒绝或强制提示；UI 意图改 `src/agent/core/*` 拒绝或强警告 |
| **A075** | 定位逻辑统一 | `edit-recovery.resolveTargetPaths` 使用 `traceUiEntryForQuery`；与 A072 主路径同一套候选；`npm run validate:ui-locate` 黄金路径通过 |

### P1 — 改对内容 / 改全引用

| ID | 工作项 | 验收标准 |
| --- | --- | --- |
| **A076** | 多候选消歧 | 同一 label 多文件时 runtime 强制 read 各候选行段；规则打分（depth、components、控件标签）；reflect 须说明选 A 不选 B |
| **A077** | prepare 证据快照 | prepare 返回/approval.details 含 `evidence: { path, startLine, endLine, matchedSnippet }`；审查 UI 展示依据片段 |
| **A078** | 轻量符号/JSX 引用 | 新工具或 indexer 扩展：`jsx.find_text("闭环")` → file+line；`symbol.find_references` 最小版；不引入重型向量库 |

### P2 — 改后闭环与长期

| ID | 工作项 | 验收标准 |
| --- | --- | --- |
| **A079** | 执行后验证回灌 | 用户 execute 文件审批后可选自动 `lint`/`typecheck`（白名单）；失败写入事件/新开 reflect 提示；不自动 apply 修复 |
| **A080** | 压缩 pin + @ 文件 | compaction 钉住最近 `filesRead` 关键片段；composer 支持 `@path` attach 传入 Loop（可先 MVP：手动选文件列表） |

### P3 — 在线 E2E（需 dev + 模型）

| ID | 工作项 | 验收标准 |
| --- | --- | --- |
| **A082** | UI 黄金路径在线试用 | `golden-path-ui-trial.mjs` 传 `uiContext.layout=triple`；Loop 后 approval 指向 composer；默认拒绝不写盘；`npm run trial:golden-path-ui` |

### 暂缓（已有 ID）

| ID | 说明 |
| --- | --- |
| A023 | Chrome DevTools / DOM 深度读取（与 A078 部分重叠，DOM 取证仍 deferred） |
| A024 | 设计解析与页面生成 |

---

## 5. 黄金路径回归用例

用于 A073–A075 及后续验收：

**用例：去掉首页左边闭环/Loop 选择**

| 检查点 | 期望 |
| --- | --- |
| 首轮工具 | `ui.trace_from_page` 或带 `uiTrace` 的 `file.locate` |
| uiContext | `layout: "triple"` 传入 Loop |
| 读取顺序 | 优先 `src/components/agent-composer.tsx`，非 `agent-panel.tsx` |
| prepare 前 | `filesRead` 含 composer |
| search 串 | 来自磁盘 exact JSX，非中文描述 |
| prepare 门禁 | 未 read 则 prepare 被拒绝 |
| 在线 E2E | 默认 `trial:golden-path-ui` PASSED（定位 composer）；`--strict` 要求模型 prepare（当前常 FAIL） |

脚本目标：`npm run validate:ui-locate`（A075）；离线全链路 `npm run validate:golden-path`（A081）；**在线 E2E** `npm run trial:golden-path-ui`（A082，需 dev + 模型）。

**回家接续**：优先 A083——模型 read 后稳定 `file.replace.prepare`，少依赖 `edit.recovery`。

---

## 6. 推荐实施顺序

```text
A073 uiContext 注入          ← 已完成
A074 prepare 硬门禁          ← 已完成
A075 recovery 统一 + validate:ui-locate  ← 已完成
A076 多候选消歧              ← 已完成
A077 prepare 证据快照        ← 已完成
A078 jsx/symbol 轻量引用     ← 已完成
A079 执行后 lint 回灌        ← 已完成
A080 @文件 + 压缩 pin        ← 已完成
A081 黄金路径全链路 validate  ← 已完成
A082 UI 在线试用 layout=triple  ← 已完成
A083 模型稳定 prepare（候选）   ← 下一步
```

---

## 7. 哲学差异（产品约束）

| | Cursor/Codex | vec-next |
| --- | --- | --- |
| 信任模型 | 强上下文 + 可自动 apply | 弱上下文 + **人审 diff** |
| 准确度杠杆 | 上下文 > 规则 | 规则/门禁 > 上下文（补 IDE 缺口） |
| 失败模式 | 改错但常 lint 自修 | 改错文件时 diff 仍可能「看起来合理」 |

因此：**改前证据链** 比 **多 reflect** 更值得投入。

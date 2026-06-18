# 与 Cursor / Codex 差距盘点与校准计划

更新时间：2026-06-03

**用途**：先对齐「差在哪、要不要跟、跟到什么程度」，再排开发任务；避免边做边猜。  
**联动**：准确度细节见 [`agent-accuracy-roadmap.md`](agent-accuracy-roadmap.md)；已完成项见 [`agent-progress.md`](agent-progress.md)。

---

## 0. 元任务（必须先做）

| ID | 标题 | 状态 | 说明 |
| --- | --- | --- | --- |
| **A096** | **差距盘点 + 校准范围确认** | done | 本文档 + 用户确认「与 Cursor 一致、去掉闭环」 |
| **A097–A099** | 左栏瘦身 + 设置 + 审查 Tab | done | 去掉 Loop/闭环；`AgentSettingsPanel`；审查 Tab |
| **A100** | 闭环去主路径 | done | UI 移除 develop；API `/api/agent/develop` 保留不动 |

### A096 验收（你点头才算完成）

1. 下文 **§2 差距表** 里 P0 项无遗漏、无「其实已 done 却标 gap」。
2. 明确 **§3 校准原则**：哪些必须像 Cursor/Codex，哪些因 Web/审批链保持差异。
3. **§4 排期** 中 A097–A105 优先级与你预期一致（可改 ID/顺序，但要有唯一 backlog）。

### A096 建议操作（你可直接回复）

- 在 §2 表里标「同意 P0 / 降级 / 不做」
- 指定首条要实现的 ID（例如只做 A097+A098，暂不动 Electron）

---

## 1. 盘点方法（怎么找差距）

对照 **可观察行为**，不按「我们有没有某个文件」：

| 来源 | 看什么 |
| --- | --- |
| **Cursor** | Composer/Agent：@ 文件、改代码是否进编辑器、diff 在哪、命令授权 UI、设置里 agent 选项（非主栏三开关） |
| **Codex** | IDE/桌面：工作区上下文、patch 应用、终端授权、thread 续聊 |
| **vec-next** | 三栏 `layout=triple` + `npm run trial:golden-path-ui`（`--strict`） |
| **已有文档** | `agent-accuracy-roadmap.md` §2 维度表（偏准确度） |

每条差距记录四列：**Cursor/Codex 行为** → **vec-next 现状** → **差距等级** → **是否要对齐**。

差距等级：

- **L0 已对齐**：行为一致或差异可接受
- **L1 体感差**：能用但明显不像（主栏开关、审查位置曾属此类）
- **L2 能力缺**：缺关键能力（IDE 内直接改、LSP、DOM）
- **L3 架构差**：Web 审批链 / 无 Electron，短期无法等同

---

## 2. 差距表（产品 + 准确度）

### A. 信息架构 / 主界面

| 能力 | Cursor / Codex | vec-next 现状 | 等级 | 是否要对齐 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 主任务区 | 对话 + 内联变更条，点进审查 | 中栏 Turn 时间线 + 变更条 | L0 | 是（已基本） | A071/A070 |
| 右侧审查 | 变更/diff 为**一级 Tab** | **审查 \| 文件 \| 浏览器** Tab | L0→L1 | 是 | 近期已改；需你验收 |
| 左侧栏 | 项目/会话/搜索，**无**实验开关主显 | 工作区 + Loop/闭环 + 会话；实验在 **高级（折叠）** | L1 | 是 | 默认应像 Cursor：主栏干净 |
| Loop vs 闭环 | **无**此二选一（同一 Agent） | 左栏 **Loop / 闭环** Tab | L2 | **待你定** | 闭环=无模型调试链，Cursor 无对应物 |
| 设置入口 | 设置页 / 命令面板 | ~~左栏 Agent 设置~~ **已移除**（A101） | L0 | — | 与 Cursor 一致：无 Agent 实验开关 |

### B. 改文件流程（最关键体感）

| 能力 | Cursor / Codex | vec-next 现状 | 等级 | 是否要对齐 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 默认写盘 | 编辑器内 **直接应用**（可配置） | **必须** 审查 → 批准并执行 | L3 | **部分** | 信任模型不同；可默认「像 Cursor」= 低风险自动写（A093 已有，应**默认策略**而非开关主显） |
| Diff 预览 | 编辑器 diff / 侧栏 | 审查 Tab 全高 diff（A094） | L1 | 是 | 缺：与**打开文件**联动、多 tab 编辑 |
| 命令审批 | 底部终端授权 | 中栏底部 `AgentCommandApprovalBar` | L0 | 是 | A091 |
| 文件审批位置 | 侧栏审查，非聊天里塞满 | 右侧审查 Tab，命令不进审查 | L0 | 是 | A092 |
| inline 接受/拒绝 | 对话旁 Accept | 审查区按钮 + 变更条跳转 | L1 | 可选 | A097 候选 |

### C. 上下文输入

| 能力 | Cursor / Codex | vec-next 现状 | 等级 | 是否要对齐 | 备注 |
| --- | --- | --- | --- | --- | --- |
| @ 文件 | `@path`、拖拽、当前 Tab | Composer `@` + 附加列表 + 右侧文件树 | L1 | 是 | A080 已有；缺 **当前编辑器选区/光标** |
| 附图 | 支持（含 **Ctrl+V 截图** A122、**拖放** A123） | 支持 | L0 | — | 最多 4 张 |
| 运行时 layout | 当前预览页 | `uiContext.layout` 传入 Loop | L0 | — | A073 |
| 打开文件集合 | 自动带 open tabs | `@` 附着 + 审查选区 → system（A117） | L2 | 部分 | Electron 真多 tab 仍 deferred |

### D. 准确度 / Agent 行为（非 UI）

| 能力 | Cursor / Codex | vec-next 现状 | 等级 | 是否要对齐 | 备注 |
| --- | --- | --- | --- | --- | --- |
| prepare 门禁 | 工具链约束 | read 证据 + 硬门禁 | L0 | 是 | A074+ |
| recovery 兜底 | 产品内隐式 | `edit.recovery` + strict 可关 | L1 | **策略** | 默认应像 Cursor：**允许 recovery**；strict 仅评测 |
| 改后 lint | 自动跑并自修 | 写盘后 verify + 可选再 Loop | L1 | 是 | A079/A086/A090；默认应**自动修**还是**提示**待校准 |
| 符号/LSP | 强 | jsx/symbol 轻量 + import 树 | L2 | 渐进 | A078；不追求 100% LSP |
| DOM/浏览器 | Browser 工具 / CDP | 桌面 WebView 文本快照 + `browser.inspect`；无 CDP DOM | L2 | partial | A023 |

### E. 平台

| 能力 | Cursor / Codex | vec-next 现状 | 等级 | 是否要对齐 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 运行环境 | 桌面 IDE | **浏览器** + 手填 Workspace 路径 | L3 | Electron | A025 |
| 工作区选择 | 文件夹选择器 | 粘贴绝对路径 | L3 | Electron | |

### F. 左栏「实验开关」专项（你截图里的问题）

| 开关 | 为何 vec-next 有 | Cursor/Codex | 校准方向 |
| --- | --- | --- | --- |
| 自动应用文件 | Web 默认不敢写盘 | 默认就能改（可关） | **默认关 + 不进主栏**；成熟后改为设置项「Auto-apply edits」 |
| lint 失败再 Loop | 无 IDE 自修 | 内置自修 | **默认关**；失败时审查区一键即可，不强迫用户理解 |
| strict prepare | 离线 `--strict` 评测 | 无此 UI | **仅开发者设置 / env**，不出现在左栏 |

---

## 3. 校准原则（改什么、不改什么）

### 3.1 必须对齐（P0 体感）

1. **右栏**：审查 = 与文件/浏览器同级的 Tab；有待审时自动聚焦审查。
2. **左栏**：只保留 Cursor 级信息——工作区、会话、运行模式（若保留）、输入相关；**实验能力不进主路径**。
3. **默认路径**：Loop + 手动审查写盘 + 命令底部授权（与当前 A091 一致）。
4. **改前证据 + 黄金路径**：准确度仍走 `agent-accuracy-roadmap`，不因「像 Cursor」砍掉门禁。

### 3.2 有意保持差异（除非上 Electron）

| 项 | 原因 |
| --- | --- |
| 审批写盘 | Web 无法等同「信任本地 IDE」；用审查 Tab 代替 |
| 无 LSP/Tab 上下文 | 浏览器 Agent 固有限制，用 @ 文件 + uiContext 补 |
| 闭环模式 | 内部调试工具链，**可对用户隐藏**或收到开发者菜单 |

### 3.3 不应再做的方向

- 左栏继续堆新的「实验」复选框（应：设置页 / env / `?dev=1`）
- 审查放回右栏下半第二段（已违背 Cursor 信息架构）
- 为通过率把 recovery/prepare 门禁从 UI 主路径绕开（应调模型与 nudge，见 A083）

---

## 4. 排期（A097+，待你确认后实施）

> **规则**：每项有 ID、优先级、验收、是否改代码；A096 确认前 **只文档，不扩大实现**。

### P0 — 产品体感对齐 Cursor/Codex（UI/IA）

| ID | 工作项 | 验收标准 | 依赖 |
| --- | --- | --- | --- |
| **A097** | **左栏主路径瘦身** | 三栏左栏仅：工作区、Loop/闭环（或合并）、会话；**无**展开即见的三实验勾；设置迁出 | A096 确认 |
| **A098** | ~~统一 Agent 设置~~ | **取消**——Cursor/Codex 无此项，改为 **A101 完全移除** | — |
| **A101** | **移除 Agent 设置与实验开关** | UI 无自动写盘/lint 再 Loop/strict 勾选；默认=手动审查+recovery；strict 仅 `trial --strict` | done |
| **A099** | **审查 Tab 行为打磨** | 有待审 → 默认审查 Tab + 徽章；无待审 → 默认文件 Tab；审查内 Accept/Reject 文案对齐 Cursor | 近期 Tab 已上，本项验收 |
| **A100** | **闭环模式去主路径** | 闭环收到「开发者选项」或隐藏；主界面仅 Agent Loop（与 Cursor 单一 Agent 一致） | 需你确认是否保留闭环 |

### P1 — 默认策略像 Cursor（仍 Web 审批）

| ID | 工作项 | 验收标准 |
| --- | --- | --- |
| **A101** | **低风险变更默认策略文档化** | 产品默认：不自动写盘、不自动 strict、允许 recovery；与 `trial:golden-path-ui` 默认模式一致 |
| **A102** | **审查区 inline 动作** | done · 中栏变更卡「应用更改」+ 审查 Tab |
| **A103** | **lint 失败 UX** | done · 仅提示 +「根据 lint 再修一轮」按钮 |

### P2 — 能力缺口（中期）

| ID | 工作项 | 验收标准 |
| --- | --- | --- |
| **A104** | **Composer @ 增强** | done · `@` 联想 + 最近附加路径 |
| **A105** | **在线对标试用清单** | done · `validate:cursor-shell-ui`；`trial:golden-path-ui` 任务已更新 |
| **A025** | **Electron / 本机工作区** | in_progress · 选文件夹 + `build:desktop`/`pack:desktop` 内置服务；CDP 仍 deferred |

### P3 — 准确度（已有 backlog，不重复造轮子）

继续 [`agent-accuracy-roadmap.md`](agent-accuracy-roadmap.md)：`trial:golden-path-ui --strict` 通过率、DOM/A023 等。

---

## 5. 推荐实施顺序（校准后）

```text
[A096] 你确认 §2 P0 + §3 原则     ← 当前
  ↓
A097 左栏瘦身 → A098 统一设置 → A099 审查 Tab 验收
  ↓
A100 闭环是否隐藏（产品决策）
  ↓
A101–A103 默认策略与 lint/审查 UX
  ↓
A104–A105 @ 与试用清单
  ↓
A025 Electron（可选大项）
```

**不建议顺序**：先做 Electron 再改 IA（成本高且 IA 仍不像 Cursor）。

---

## 6. 与近期已做项的关系（避免重复劳动）

| 已完成 | 在差距表中的位置 | 下一步 |
| --- | --- | --- |
| A091–A092 命令底栏 + 文件审查分离 | §2B L0 | 维持 |
| A094 审查全高 diff | §2B L1 | A099 验收交互 |
| 审查 Tab + 高级折叠 | §2A L1→L0 | A097/A098 固化，勿回退下半审查 |
| A093/A090/A095 三开关 | §2F | A097/A098 **迁出左栏**，非删能力 |
| A073–A088 准确度 | §2D | 继续 golden-path / strict 评测 |

---

## 7. 验证命令（盘点期）

```bash
# 离线能力回归
npm run validate:agent

# 在线体感（需 dev + 模型）
npm run trial:golden-path-ui
node scripts/golden-path-ui-trial.mjs --strict
```

**人工对照清单**（A096 建议你本地勾一遍）：

- [ ] 右栏是否仅 **审查 | 文件 | 浏览器** 三个 Tab
- [ ] 左栏是否 **无** 默认展开的三实验勾
- [ ] 文件变更是否只在 **审查 Tab**，命令是否在 **输入框上方**
- [ ] 与 Cursor 并排放 5 分钟：改同一句话（如去掉 Loop 文案）流程差在哪

---

## 8. 文档维护

| 变更 | 更新哪里 |
| --- | --- |
| 新差距项 | 本文 §2 + §4 |
| 某项 done | `agent-progress.md` + 本文状态列 |
| 准确度-only | `agent-accuracy-roadmap.md` |
| 短期排期 | `agent-plan-next.md` 指向本文 §4 |

# Agent 接续备忘（Cursor 对齐 + 黄金路径）

更新时间：2026-06-18

> 下次开工先读本文，再跑 `npm run validate:agent`。  
> **内置浏览器 Codex 对齐主路线**：下文 **§ Codex 浏览器 / DevTools 对齐（A130+）**。

---

## 内核状态（A112–A130 done）

| 项 | 说明 |
| --- | --- |
| **A114** | 默认原生 `tools`/`tool_calls`；`AGENT_LOOP_JSON_PROTOCOL=1` 回退 |
| **A115** | 大 tool 结果外置 `.agent-state/tool-results/` |
| **A116** | collapse 投影调研 → defer 全量移植 |
| **A117** | open tabs → `buildOpenEditorUiContext` |
| **A118** | soft tool-collapse（middle 旧 tool stub） |
| **A119** | 离线压缩基准；SSE `layersApplied` |
| **A120** | micro 层兼容原生 `role:tool` |
| **A121** | OpenAI tool 名编码（`file.read` → `file_read`） |
| **A122** | Composer Ctrl+V 粘贴截图 |
| **A123** | Composer 拖放截图 + 状态提示 |
| **A124** | 发送后聊天区用户气泡展示附图 |
| **A125** | 工具观测墓碑 stub + 用户锚点 |
| **A126** | 爆发段感知 tail（`AGENT_LOOP_BURST_TAIL_MIN` / `AGENT_LOOP_BURST_TAIL=0` 关闭） |
| **A127** | UI 展示压缩层 `layersApplied`（时间线 + 底部状态） |
| **A128** | 内置浏览器稳定性（禁同源、`-3` 忽略、快照失败不误报） |
| **A129** | Codex 式 WebView + Cursor Chrome UI |
| **A130** | **CDP HTTP 桥** + 10 个 `devtools.*` 工具（与 Codex/chrome-devtools-mcp 同级读+操作） |
| **A131** | **TaskPlaybook 内核** | `task-playbooks.ts`：browser-doc / ui-visible-edit / file-exact / read-only；通用熔断 + 轮次预算 + 中间区路径展示 |
| **A132** | **审查 Tab Cursor 对齐** | 应用更改/放弃更改、空态分场景、文件 ←→ 导航、自动选中首个 diff、`cursor-review-notes.template.json` |
| **A133** | **浏览器多标签** | `browser-tabs.json`；`devtools.list_pages` / `new_page` / `switch_page`；CDP `/pages` + `/activate`；右栏 Tab 条 |
| **A140** | **Cursor 级终端 + 自举** | `shell.run.prepare` 任意 workspace 命令（审批后执行）；`shell.command.prepare` 扩至 package.json 全 scripts；`capability-extension` 剧本 |
| **A141** | **命令审批 UX + 失败 recovery** | 聊天气泡内联「批准并运行」；`assistant.notice` 成功/失败；批准后 Loop 续跑 + 端口占用 recovery 提示；ANSI 清理；`dev` 长进程 ready 检测 |

**产品**：对齐 Cursor 剪贴板附图；最多 4 张，走现有 `referenceImages` + vision 模型链路。

**终端（A140 + A141）**：

- Agent 用 `shell.run.prepare` / `shell.command.prepare` → **聊天气泡或底部** `AgentCommandApprovalBar` → 批准并运行。
- 执行结果：`approval.executed` + 绿/红 `assistant.notice`；已执行后隐藏重复「待授权」行。
- 失败后：`maybeResumeLoopAfterApproval` 续跑，续跑 prompt 含「不得只汇报失败就 final」+ 端口占用换 `--port` 等提示（**仍须用户再次批准每条新命令**）。
- 破坏性命令策略拦截；改 Loop 内核后需重启 dev。

**已知架构差（2026-06-18 实机暴露）**：Claude Code / Cursor 的 Bash 在 **Loop 内** `tool_result` 闭环；本项目仍是 **prepare → 退出 Loop → 批准 → execute → 再开 Loop**。审计表 L6 Shell 曾标 `defer`，导致 A140 只补 UI 未补 harness 语义。下一优先：`trial:shell-recovery` + 读 `claude-code` Bash 链路（见 `agent-kernel-audit.md` L6）。

**实机长线程**（2026-06-18）：`trial:long-thread` 通过 — Task1 4 次压缩（`snip:1,auto`），无 emergency `collapse`。报告：`.agent-state/compare/long-thread-trial.json`

**压缩基准**（离线）：`npm run validate:compaction-benchmark` → `.agent-state/compare/compaction-benchmark.json`

**实机长线程**（需 dev + 模型）：`npm run trial:long-thread`

### 环境开关

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `AGENT_LOOP_JSON_PROTOCOL=1` | 关 | 回退 JSON 协议 |
| `AGENT_TOOL_RESULT_EXTERNALIZE=0` | 开 | 关则内联截断 |
| `AGENT_LOOP_SOFT_COLLAPSE=0` | 开 | 关 soft collapse |
| `AGENT_LOOP_SOFT_COLLAPSE_RATIO` | 0.70 | soft 触发比例 |
| `AGENT_LOOP_BURST_TAIL_MIN` | 4 | 爆发段 tail 最少条数 |
| `AGENT_LOOP_BURST_TAIL=0` | 开 | 关则固定 `TAIL_KEEP` |
| `AGENT_EDIT_RECOVERY=1` | 关 | recovery |
| `AGENT_FINAL_PREPARE_NUDGE=1` | 关 | 末轮 prepare nudge |

### 回归

```bash
npm run validate:agent
npm run trial:golden-path-sidebar:strict   # 有模型时
```

---

## 产品决策（不变）

日常不用 prepare 硬门禁；自动写盘默认开。`assertPrepareGate` 仅 strict / 评测。

---

## 待办（可选）

| 优先级 | 内容 |
| --- | --- |
| **P0** | **`trial:shell-recovery`**：实机「跑 dev → 端口占用 → Agent 须 prepare 第二条命令（如 `--port 5175`）」；验收脚本待写 |
| **P0** | **对标 Claude Code Bash**：读 `D:\案例\claude-code-claude\...\query.ts` + Bash 工具；更新 `agent-kernel-audit.md` L6；评估 tool_result 回灌或 dev playbook |
| P1 | **dev-run playbook**：`task-playbooks.ts` 绑定「启动项目 / 跑 dev」→ 端口冲突 → 查占用 → 换端口 |
| P2 | Electron 签名 / 自动更新 |
| P2 | Electron PTY 可视化终端面板（A140 已交付命令审批+执行，缺 xterm UI） |
| 观测 | 实机 `trial:long-thread` 记录 `layersApplied` 是否出现 `collapse` |

**明确不做**：「接受当前文件」；Claude 全量双轨 CONTEXT_COLLAPSE；首期不移植 chrome-devtools-mcp 全 40+ 工具名（用本项目 `devtools.*` + 同一 CDP 底座）。

---

## Codex 浏览器 / DevTools 对齐（A130+）— **下一主任务**

**目标**：右栏内置浏览器 = Codex App 同级 WebView；Agent 工具 = Codex Developer mode / chrome-devtools-mcp **同等能力**（读 DOM / 样式 / 网络 / console / 截图 / 点击输入 / 性能 trace），走 **Chrome DevTools Protocol**，不用 Playwright 主链路。

### 三层（与 `agent-architecture.md §14` 一致）

```text
内置浏览器 UI（A129 done）
  → 用户看页面、地址栏、导航

CDP 工具层（A130+ in_progress）
  → devtools.* 读 + 操作，底层 CDP

设计解析（A024 deferred）
  → devtools.extract_design_spec → design spec JSON
```

### 能力对照（Codex ↔ vec-next）

| Codex / chrome-devtools-mcp | 本项目工具（规划） | 现状 |
| --- | --- | --- |
| `navigate_page` / 打开页 | `browser.open` | ✅ |
| `take_snapshot` / DOM | `devtools.get_dom_snapshot` | ⚠️ `browser.inspect` 仅文本大纲 + query |
| `take_screenshot` | `devtools.get_screenshot` / `browser.inspect` | ⚠️ CDP 截图有，未独立 tool |
| `list_console_messages` | `devtools.get_console_errors` | ⚠️ WebView console-message，非 CDP Log |
| `list_network_requests` | `devtools.get_network_requests` | ⚠️ responseReceived 片段 + HAR-lite |
| `click` / `fill` / `type_text` | `devtools.click` / `devtools.type` | ❌ |
| `evaluate_script` | CDP `Runtime.evaluate`（内置于各 read） | ⚠️ 仅 probe 注入 |
| AX tree | `devtools.get_accessibility_tree` | ❌ |
| box / computed style | `devtools.get_box_model` / `get_computed_style` | ❌ |
| 坐标探测 | `devtools.inspect_element_at` | ❌ |
| `performance_start_trace` | CDP Performance（二期） | ❌ |
| 多标签 | `list_pages` / `new_page` | ✅ A133 `devtools.list_pages` / `new_page` / `switch_page` |

### 实施顺序（建议严格执行）

| ID | 工作项 | 验收 |
| --- | --- | --- |
| **A130** | **CDP 会话网关 + devtools.\*** | HTTP 桥 `127.0.0.1:19229`；10 个 devtools 工具；`validate:browser-cdp-gateway` |
| A131–A138 | 性能 trace / 多标签 / design spec | 见 handoff § Codex 对齐 |

### 技术约束

- **唯一 CDP 附着点**：Electron `<webview>` guest（`electron/browser-cdp.mjs`），与右栏预览 **同一页面**。
- **桌面必选**：`npm run dev:desktop`；网页版不承诺 Codex 同级。
- **权限**：外链首次访问可记 trace；高风险交互与 Codex 一样需产品层审批策略（后续）。

### 开工命令

```bash
npm run validate:agent
npm run dev:desktop
# A130 起每阶段加 validate:browser-cdp-*
```

---

## 关键路径

| 区域 | 路径 |
| --- | --- |
| Loop | `src/agent/core/agent-loop.ts` |
| 压缩 | `src/agent/memory/loop-context-compactor.ts`, `loop-compaction-layers.ts` |
| 外置 | `src/agent/memory/tool-result-storage.ts` |
| Shell 执行 | `src/agent/tools/shell-runner.ts`, `shell-output.ts`, `shell-command-policy.ts` |
| 命令审批 UI | `src/components/agent-panel.tsx`, `agent-turn-worked-line.tsx`, `agent-turn-block.tsx` |
| 批准后续跑 | `src/lib/approval-loop-continuation.ts`, `src/lib/approval-chat-events.ts` |
| 审计 | `docs/agent-kernel-audit.md` |

---

## 接续收工（2026-06-18 · 终端实机）

**现象**：用户「跑一下 dev」→ 批准 `npm run dev` → 端口 5173/5174 占用 + ANSI 乱码 → 像「宕机」（实为 Loop 已结束，续跑后模型只总结失败）。

**本批交付（A141）**：

| 范围 | 内容 |
| --- | --- |
| 执行层 | ANSI 剥离；`dev/start` 长进程 spawn + `ready`/`Local:` 判成功；端口占用中文提示 |
| 聊天 UX | 内联「批准并运行 / 拒绝」；`assistant.notice` 气泡；已执行后隐藏「待授权」 |
| 续跑 | `approval-loop-continuation.ts` 失败 recovery（禁止 failure-only final；嵌套 result 解包） |
| Prompt | `loop-system-native.md` shell 失败须诊断并重试 |
| 验证 | `validate:shell-run`、`validate:approval-continuation`；`npm run build` 通过 |

**回家前回归**：

```bash
npm run validate:agent
npm run build
# 实机（可选）：npm run dev → 「跑一下 dev」→ 批准 → 看绿/红气泡 + 失败是否续跑 prepare 新命令
```

**下次开工第一件事**：读本文 § 已知架构差 → 做 `trial:shell-recovery` 或 dev playbook。

---

## 文档联动

- 压缩基准：[`agent-compaction-benchmark.md`](agent-compaction-benchmark.md)
- Collapse 调研：[`agent-collapse-projection-spike.md`](agent-collapse-projection-spike.md)
- 台账：[`agent-progress.md`](agent-progress.md)

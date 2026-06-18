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

**产品**：对齐 Cursor 剪贴板附图；最多 4 张，走现有 `referenceImages` + vision 模型链路。

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
| **P0 主任务** | **A130–A139**：内置浏览器 + `devtools.*` 对齐 Codex（见下节） |
| P2 | Electron 签名 / 自动更新 |
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
| 多标签 | `list_pages` / `new_page` | ❌ 单页 |

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
| 审计 | `docs/agent-kernel-audit.md` |

---

## 文档联动

- 压缩基准：[`agent-compaction-benchmark.md`](agent-compaction-benchmark.md)
- Collapse 调研：[`agent-collapse-projection-spike.md`](agent-collapse-projection-spike.md)
- 台账：[`agent-progress.md`](agent-progress.md)

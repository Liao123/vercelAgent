# Agent 接续备忘（Cursor 对齐 + 黄金路径）

更新时间：2026-06-18

> 下次开工先读本文，再跑 `npm run validate:agent`。

---

## 内核状态（A112–A119 done）

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
| **A122** | Composer **Ctrl+V 粘贴截图**（Win+Shift+S → 输入框） |
| **A123** | Composer **拖放截图** + 成功状态提示（已粘贴/已拖入/已附加） |
| **A124** | 发送后聊天区用户气泡展示附图 |

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
| P2 | Electron 签名 / 自动更新 / 完整 CDP |
| 观测 | 实机 `trial:long-thread` 记录 `layersApplied` 是否出现 `collapse` |

**明确不做**：「接受当前文件」；Claude 全量双轨 CONTEXT_COLLAPSE。

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

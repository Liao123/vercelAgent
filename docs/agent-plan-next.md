# Agent 后续计划（排期入口）

更新时间：2026-06-01

> **下次接着干**：先看 **[`agent-handoff.md`](agent-handoff.md)**（本轮 UI/闭环/报错修复 + 验证清单）。  
> **与 Cursor/Codex 对齐的单一 backlog**：见 **[`agent-cursor-codex-gap.md`](agent-cursor-codex-gap.md)**（差距表 + A097+ 排期）。  
> **准确度专项**：见 [`agent-accuracy-roadmap.md`](agent-accuracy-roadmap.md)。  
> **进度台账**：见 [`agent-progress.md`](agent-progress.md)。

---

## 当前阶段

| 阶段 | ID | 状态 | 说明 |
| --- | --- | --- | --- |
| **差距盘点与校准** | **A096** | done | [`agent-cursor-codex-gap.md`](agent-cursor-codex-gap.md) |
| 体感对齐 | A097–A101 | done | 去闭环、无 Agent 设置、审查\|文件\|浏览器 Tab |
| 默认策略 | A102–A103 | done | 中栏「接受」、Composer ⚙、写后验证+自动再修默认开；见 `agent-defaults.md` |
| **接续（未编号）** | **handoff** | doing | Cursor 审查/设置/Loop 闭环；见 [`agent-handoff.md`](agent-handoff.md) |
| 能力增强 | A104–A105 | done | Composer @ 联想、`validate:cursor-shell-ui` |
| Electron | A025 | in_progress | 桌面壳 + 文件夹选择器；见 `agent-electron.md` |

---

## A086–A095 已完成（摘要）

| ID | 内容 |
| --- | --- |
| A085–A088 | 消歧、thread hint、lint 回灌 Loop、末轮 prepare、右侧文件 Tab |
| A089/A095 | `strictPrepare` API + 左栏开关（**A097 拟迁出主栏**） |
| A091–A092 | 命令底部授权；文件仅右侧审查 |
| A093 | 可选自动写盘（**A097 拟迁设置**） |
| A090 | lint 失败再 Loop（**A097 拟迁设置**） |
| A094 | 审查区编辑器式全高 diff |

近期 UI：右栏 **审查 \| 文件 \| 浏览器**；左栏实验项收进 **高级（实验）** 折叠——属 A096 盘点中的 L1，由 A097–A099 验收固化。

---

## 验证

```bash
npm run validate:agent
npm run trial:golden-path-ui
node scripts/golden-path-ui-trial.mjs --strict
```

人工对照 Cursor/Codex：见 `agent-cursor-codex-gap.md` §7。

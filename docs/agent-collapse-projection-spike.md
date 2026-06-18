# A116：Collapse 投影调研（Claude `CONTEXT_COLLAPSE` vs vec-next）

更新时间：2026-06-17

## 问题

Claude Code 在 **每次 API 调用前** 会对 messages 做 **读时投影（collapse projection）**：不删除底层 transcript，只在发给模型的视图上折叠旧 tool 轮次。vec-next 当前在 **emergency** 时做 **destructive collapse**（删 middle、写 `[COMPACTED_MEMORY]`、只留 head + 4 tail）。

## Claude 行为（`query.ts` + `services/compact/collapse`）

| 维度 | Claude | vec-next 现状 |
| --- | --- | --- |
| 时机 | 每 turn、在 autocompact **之前** | 仅 `needsEmergencyCollapse`（≈96% max context） |
| 数据 | 投影层；原始消息保留 | 物理删除 middle，合并进滚动记忆 |
| 目标 | 减 API tokens，不丢可恢复 transcript | 防 413 / 超长崩溃 |
| 与 micro 关系 | snip → micro → **collapse** → autocompact | snip → micro → auto/semantic → **collapse** |

## vec-next 已有能力（是否够用）

1. **A109 五层压缩** + **A115 外置**：大 observation 不再硬截断丢信息，可 `file.read` 读回。
2. **滚动 `[COMPACTED_MEMORY]`**：pinned facts / snippets / prepare 候选可跨轮保留。
3. **Emergency collapse**（`loop-context-compactor.ts` L938+）：最后一道闸，与 Claude 日常 collapse **语义不同**。

## 移植成本评估

要实现 Claude 式 **非破坏性投影**，需要：

1. **双轨 messages**：`transcript[]`（全量持久）+ `projected[]`（每轮 `generate` 输入）。
2. **Collapse 规则引擎**：按 tool 类型 / token 预算折叠为 stub，且与 native `role:tool` 消息兼容。
3. **Trace / thread 恢复**：投影状态与 `[COMPACTED_MEMORY]` 合并策略需重新定义。
4. **验证矩阵**：long-thread、prepare-hint、attached-pin 全部要重跑。

预估：**3–5 天** 内核改动 + 全量 `validate:agent` 回归，收益主要在「极长单 task 内少触发 emergency」。

## 结论与建议

| 决策 | 说明 |
| --- | --- |
| **短期：不移植完整 CONTEXT_COLLAPSE** | A115 外置 + 现有五层压缩已覆盖主要 token 风险；投影层投入产出比低。 |
| **中期可选** | 将 emergency collapse 提前为 **soft collapse**（仅折叠 `role:tool` / Observation，不 merge memory），仍不写双轨 transcript。 |
| **指标** | 用 `trial:long-thread` 对比「外置前后」emergency 触发率；若仍频繁再开 soft collapse。 |

**A116 状态**：调研完成，**defer 全量投影**；backlog 可新增 **A118 soft tool-collapse**（可选）。

## 参考命令

```bash
npm run validate:compaction-layers
npm run trial:long-thread
npm run validate:tool-result-externalize
```

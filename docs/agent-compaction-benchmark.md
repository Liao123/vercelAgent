# A119：长线程压缩层离线基准

更新时间：2026-06-18

## 目的

在不依赖 dev server / 模型 API 的情况下，对比 **A115 外置**、**A118 soft collapse** 对 token 与压缩层触发的影响。

## 运行

```bash
npm run validate:compaction-benchmark
```

## 最近一次基准（vec-next 工作区）

| 场景 | Round1 tokens | Round1 layers | Emergency collapse |
| --- | --- | --- | --- |
| 默认（soft 开） | 21258 → **7883** | `soft:16`, `auto` | 否 |
| `AGENT_LOOP_SOFT_COLLAPSE=0` | 21258 → **9290** | `auto` | 否 |

结论：

1. **soft collapse** 在 auto-compact 前折叠 16 条过旧 tool 观测，Round1 末 token 约低 **15%**（9290 → 7883）。
2. 本 fixture **未触发** emergency `collapse` 层（96% 阈值）。
3. 实机长任务请再跑 `npm run trial:long-thread`（需 dev + 模型）；SSE `context.compacted` 现已带 `layersApplied`。

## 实机结果（2026-06-18）

`trial:long-thread` 通过：Task1 **4** 次 `context.compacted`（layers 含 `snip:1,auto`），**未触发** emergency `collapse`。落盘：`.agent-state/compare/long-thread-trial.json`。

## 实机试用

```bash
npm run dev
npm run trial:long-thread
```

活动流中压缩事件会打印 `layers snip:…, micro:…, soft:…, auto, collapse`。

## 联动

- 调研：[`agent-collapse-projection-spike.md`](agent-collapse-projection-spike.md)
- 内核审计：[`agent-kernel-audit.md`](agent-kernel-audit.md)

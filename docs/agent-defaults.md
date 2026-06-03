# Agent 产品默认策略（对齐 Cursor / Codex）

更新时间：2026-06-03

Web 版 vec-next **有意** 与桌面 IDE 保持以下默认差异：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 写盘 | **默认自动**（低/中风险文件） | 对齐 Cursor：直接写入，无「接受当前文件」；⚙ 可关；高风险仅在审查 Tab 点「接受」 |
| strict prepare | 关 | Composer ⚙ 开启；评测用 `--strict` |
| recovery | 开 | strict 开启时禁用 |
| lint 再 Loop | **默认自动** | 写盘后跑 lint/typecheck/build；失败自动再修（⚙ 可关） |
| 执行后验证 | 有脚本则跑 | 改 ts/tsx/js 等后依次 lint → typecheck → build，失败即停 |
| 实验开关 | Composer ⚙ | 不在左栏展示 |

验证：`npm run validate:agent`、`npm run validate:cursor-shell-ui`。

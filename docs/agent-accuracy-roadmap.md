# 开发准确度路线图（Cursor / Codex 对照）

更新时间：2026-06-18

**状态**：A073–A082、A106 **已全部 done**。本文仅保留回归用例与哲学约束；排期见 [`agent-handoff.md`](agent-handoff.md)。

## 仍有效的回归

```bash
npm run validate:agent          # 离线黄金路径
npm run trial:golden-path-ui    # 在线 UI（需 dev + 模型）
npm run trial:golden-path-sidebar
```

## 黄金路径用例（侧栏加号）

1. 三栏 layout，query 含「新建 Agent / 加号」类 UI 文案  
2. `ui.trace_from_page` / `file.locate` 命中 `agent-session-sidebar.tsx`  
3. `file.read` composer 区域，非 `agent-panel` / `agent/core`  
4. 审批或写盘目标正确（dry-run 可 reject）

## 哲学约束（产品不变）

- **改前证据**：trace/locate → read → prepare，不凭中文猜 search  
- **UI 可见文案**：`jsx.find_text` 优先于裸 `file.search`  
- **Web 审批链**：与 Cursor 桌面 IDE 不等同；命令须批准  

决策索引：D029–D048 见 [`agent-memory.md`](agent-memory.md)。

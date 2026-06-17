# Agent 接续备忘（Cursor 对齐 + 黄金路径）

更新时间：2026-06-17

> 下次开工先读本文，再跑验证命令。聊天上下文不必保留。

---

## 最新（2026-06-17 · A106）

**阶段结论**：闭环/Loop 主路径 UI 已移除后，离线黄金路径已迁移为 **侧栏项目行「＋」**；`npm run validate:agent` **全绿**（~90s）。

| 项 | 内容 |
| --- | --- |
| **A106** | 消歧 / jsx / prepare 对齐 handoff P0；`scripts/golden-path-fixtures.ts` |
| 离线 | `validate-golden-path` → `agent-session-sidebar.tsx` L460 `+` |
| 在线 | `npm run trial:golden-path-sidebar`（新脚本，需 dev + 模型） |
| 修复 | `validate-electron-shell`、`validate-browser-desktop`；Windows 写后 lint `shell: true` |
| **P0 UI（2026-06-17）** | 全链路：自动写盘 ✓ → 写后 lint ✓ → 自动再修 ✓ → prepare ✓ → 自动写盘（lint 修复）✓ |
| **P0 写后验证（2026-06-17）** | lint 仅扫 `changedPaths`（`runScopedLintCommand`）；`electron/**` 加入 eslint ignore |
| **P0 API（2026-06-17）** | `GET /api/agent/approvals` 列表瘦身（默认 summary + limit=50，~1MB→~77KB）；单条详情 `GET /api/agent/approvals/[id]`；审查聚焦时按需 hydrate |

**回归命令**：

```bash
npm run validate:agent
npm run trial:golden-path-sidebar      # handoff P0（侧栏加号）
npm run trial:golden-path-ui           # composer placeholder（A082）
```

---

## 本轮已完成（2026-06-01）

### UI / 三栏（对齐 Cursor）

| 项 | 文件/说明 |
| --- | --- |
| 审查区上下布局 | 上：横向文件标签；下：diff；默认**不选中**文件 |
| Git 只读回退 | 无 Agent 审批时，`collectReviewDisplay` 用 `workspace.git.files` + `/api/agent/workspace/file-diff` |
| Composer ⚙ 设置 | `src/components/agent-agent-settings.tsx`：自动写盘、strict prepare、lint 失败自动再修 |
| 文案「接受」 | 中栏变更卡 / 审查底栏；三栏下中栏**不重复**接受按钮（`showInlineFileChangeActions={false}`） |
| 审查底栏 | 仅 **pending** 文件审批：`ReviewActionBar` 拒绝 / 接受 |
| 写后验证展示 | 变更卡下 `PostExecuteVerificationView`；`agent-turn-feed` 聚合 `verification.completed` |

### 默认策略（见 `agent-defaults.md`）

- 自动写盘（低/中风险）：`readAutoApplyFileChanges()` 未设置时 **默认 true**
- lint 失败自动再修：`readAutoReloopOnLintFail()` 未设置时 **默认 true**
- 写盘后验证脚本顺序：**lint → typecheck → build**（`post-execute-verify.ts`）

### Loop 思考闭环（修复「审批未就绪」死循环）

| 问题 | 修复 |
| --- | --- |
| 新任务仍加载上轮 lint 失败 | `.agent-state/post-execute-verify.json` 仅在 `isPostExecuteFixContinuation(request)` 时注入；否则 `clearStoredPostExecuteVerification` |
| 每步 tool 都反思 | `postExecuteFeedback` 仅在 `!approvalPrepared` 时触发 `shouldInjectRuntimeReflection` |
| 文案误导 | 区分 **lint 待修** vs **审批已就绪**；`prepare` 成功生成审批后清除 `postExecuteFeedback` |
| 验证通过后仍残留 | `approvals/execute` 成功时 `clearStoredPostExecuteVerification` |

关键文件：`src/agent/core/agent-loop.ts`、`src/lib/agent-lint-reloop.ts`（`isPostExecuteFixContinuation`）。

### 运行时错误修复

- **现象**：`useAgentWorkspaceBridge is not defined`（侧栏 `AgentSessionSidebar`）
- **处理**：命名空间导入 `AgentWorkspaceBridge.useAgentWorkspaceBridge()`；去掉 `useWorkspaceBridge` 别名
- **本地**：删 `.next` 后 `npm run dev`；用户环境若仍报错务必清缓存

```powershell
cd "d:\案例\vec-next"
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

---

## 下次第一件事（建议顺序）

1. **（可选）提交本轮**：approvals API 瘦身 + scoped lint + eslint ignore
2. **在线复验**：`npm run trial:golden-path-sidebar -- --strict`（dev + 模型）
3. **产品向**：A025 Electron CDP / 审查区与打开文件联动

```bash
npm run validate:agent
npm run trial:golden-path-sidebar      # 有模型时
```

---

## 待办 backlog（未做 / 可选）

| 优先级 | 内容 |
| --- | --- |
| P0 | done | 侧栏加号 + 浏览器自动写盘/lint/再修 + approvals API 瘦身 + scoped lint |
| P1 | Electron 浏览器 Tab CDP（A025 deferred） |
| P2 | @ 提及带当前编辑器选区（需桌面/IDE） |
| P2 | 审查区与打开文件联动（单 tab 预览）——部分已在 `validate:cursor-shell-ui` 断言 |

**明确不做**：「接受当前文件」（Cursor 也无此操作）；保持整批接受 / 自动写盘。

---

## 关键路径速查

| 区域 | 路径 |
| --- | --- |
| 审查 | `agent-review-panel.tsx`, `approval-file-changes.ts` |
| 三栏壳 | `agent-panel.tsx`, `agent-right-rail.tsx` |
| 中栏轮次 | `agent-turn-feed.ts`, `agent-turn-change-card.tsx`, `agent-event-timeline.tsx` |
| Loop | `agent/core/agent-loop.ts`, `agent-loop-state.ts` |
| 写后验证 | `agent/verification/post-execute-verify.ts`, `api/agent/approvals/execute/route.ts` |
| 偏好 | `agent-file-auto-apply.ts`, `agent-lint-reloop.ts`, `agent-agent-settings.tsx` |
| Bridge | `agent-workspace-bridge.tsx`, `agent-session-sidebar.tsx` |

---

## 与用户对话相关的已知坑

1. **审查 Tab 空**：只有 Agent 审批或 Git 脏文件；手改文件需 Git 仓库 + M 标记 + 打开审查 Tab 刷新 workspace
2. **思考重复 2–4 轮同一句**：多半是陈旧 `post-execute-verify.json`；已用 `isPostExecuteFixContinuation` 缓解，需新会话验证
3. **dev 报错 hook 未定义**：几乎总是 `.next` 缓存；清目录重启 dev

---

## 文档联动

- 产品默认：`docs/agent-defaults.md`
- 差距表：`docs/agent-cursor-codex-gap.md`
- 排期入口：`docs/agent-plan-next.md`
- 台账：`docs/agent-progress.md`（下次完成项请改状态为 done）

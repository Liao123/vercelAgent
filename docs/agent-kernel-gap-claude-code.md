# Agent 内核对标：vec-next vs Claude Code

更新时间：2026-06-17

参考来源：

- 本地 clone：`D:\案例\claude-code-claude`（`src/services/compact/*`、`src/services/compact/prompt.ts`）
- 博文解读：[Claude Code 源码分析 · 五层压缩](https://duoblog.com/blog/claude-code/source-code-analysis#%E4%B8%8A%E4%B8%8B%E6%96%87%E5%8E%8B%E7%BC%A9%E4%BA%94%E5%B1%82%E9%80%92%E8%BF%9B%E7%AD%96%E7%95%A5)

> 用途：指导 vec-next **内核**演进（压缩、记忆、系统提示），不照搬泄露源码。

---

## 主循环

| 维度 | Claude Code | vec-next |
|------|-------------|----------|
| 模式 | TAOR（Think→Act→Observe→Repeat） | reflect → tool_call → observation → repeat |
| 控制器 | ~50 行 async generator | `agent-loop.ts` + JSON 决策协议 |
| 工具 | Read/Write/Edit/Bash + MCP | `agent-loop-tools.ts` 审批门禁工具 |

**结论**：结构同构，vec-next 多了一层「审批 prepare」与显式 reflect JSON。

---

## 上下文压缩五层

| 层 | Claude Code | vec-next（A109） | 代码 |
|----|-------------|------------------|------|
| 1 Snip | 删除低价值旧消息 | ✅ `snipLowValueMiddleMessages` 剪纯反思轮次 | `loop-compaction-layers.ts` |
| 2 Microcompact | 清空旧 tool 结果 | ✅ `microCompactMiddleObservations` | 同上 |
| 3 Auto-Compact | 子进程/模型摘要 | ✅ 确定性 + `provider.compact` 语义合并 | `loop-context-compactor.ts` |
| 4 Reactive | API 超长紧急压 | ✅ `forceCompact` + `isContextOverflowError` 重试 | `agent-loop.ts` |
| 5 Collapse | 分阶段裁剪 | ✅ `needsEmergencyCollapse` 极简记忆 + 短 tail | `loop-context-compactor.ts` |

验证：`npm run validate:compaction-layers`

---

## 六层记忆

| 优先级 | Claude Code | vec-next |
|--------|-------------|----------|
| 组织/项目规则 | CLAUDE.md | `AGENTS.md`、项目 rules（部分） |
| 用户偏好 | 设置 + MEMORY.md | Composer ⚙、`agent-defaults.md` |
| 会话 | transcript | Thread `[THREAD_MEMORY]` |
| 任务滚动记忆 | compact boundary | `[COMPACTED_MEMORY]` + pinned facts/snippets |
| 跨会话偏好 | MEMORY.md ≤25KB | ⏳ 待做：`.agent-state/MEMORY.md` |
| 可压 transcript | 最低优先级 | Loop middle/tail |

---

## 系统提示词

| Claude Code | vec-next |
|-------------|----------|
| `getCompactPrompt` 专用压缩 prompt（analysis + summary 块） | `runSemanticCompact` 简短 merge 指令 |
| 主系统 prompt 极大、按功能拆分 | `createSystemPrompt` 单文件长字符串（UI/prepare 规则较全） |
| NO_TOOLS_PREAMBLE 防 compact 时调工具 | ❌ 未单独拆 compact 子 prompt |

**下一步（A110）**：

1. 抽出 `src/agent/prompts/compact.md`（参考 Claude `prompt.ts` 的 analysis/summary 结构）
2. 抽出 `src/agent/prompts/loop-system.md`，`validate:agent` 断言关键句
3. 加载工作区 `MEMORY.md`（若存在）注入 system 尾部

---

## 明确不做 / 暂缓

- KAIROS 7×24 后台 Agent
- Coordinator 多 Agent 并行
- bashSecurity 2300 行（我们用审批 + prepare 门禁）
- 反蒸馏假工具注入

---

## 回归命令

```bash
npm run validate:agent
npm run validate:compaction
npm run validate:compaction-layers
npm run validate:thread-memory
```

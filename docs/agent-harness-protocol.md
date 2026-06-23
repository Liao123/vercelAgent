# Agent Harness 协议（阶段 D）

更新时间：2026-06-22

> 自研 Codex-like harness：`agent-server` 长驻 + Next/Electron 作客户端。  
> 源码契约：`src/agent/protocol/harness.ts` · 校验：`npm run validate:harness-protocol`

---

## 版本

| 字段 | 值 |
| --- | --- |
| `HARNESS_PROTOCOL_VERSION` | `1.0` |
| 发现方式 | `GET /health` → `harness.version` |

---

## 路由（agent-server 默认 `127.0.0.1:3920`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 能力探测 + 协议版本 |
| POST | `/loop` | Agent Loop，**SSE 流** |
| GET | `/trace` | 持久化 trace（`?id=` / `?taskId=` / 列表） |
| GET | `/mcp` | MCP registry 快照 |
| GET | `/mcp/tools` | 模型侧 tool definitions |
| POST | `/mcp/reload` | 重载 MCP |
| POST | `/mcp/call` | `{ internalName, args }` |
| GET | `/pty` | PTY 状态 |
| POST | `/pty` | spawn / write / resize / kill |
| GET | `/pty/:sessionId/stream` | PTY 输出 **SSE 流** |

Next 代理（设 `AGENT_SERVER_URL`）：

| Next | agent-server |
| --- | --- |
| `POST /api/agent/loop` | `/loop` |
| `GET /api/agent/traces` | `/trace`（仅 `AGENT_LOOP_REMOTE≠0` 时代理） |
| `GET/POST /api/agent/mcp` | `/mcp` · `/mcp/reload` |
| `GET/POST /api/agent/pty` | `/pty` |
| `GET /api/agent/pty/:id/stream` | `/pty/:id/stream` |

---

## SSE 流（两种 profile）

### 1. `agent-loop`（Loop 任务进度）

- **Content-Type**：`text/event-stream; charset=utf-8`
- **帧格式**：

```
event: task.created
data: {"type":"task.created","taskId":"...","task":{...}}

```

- **`event` 行** = `AgentEvent.type`
- **`data` 行** = 完整 `AgentEvent` JSON（含 `type` 字段，UI 以 `data` 为准）

已注册事件名见 `HARNESS_LOOP_EVENT_TYPES`（与 `src/agent/types.ts` 中 `AgentEvent` 对齐）。

终端事件：`task.completed` · `task.failed` · `task.cancelled` · `task.awaiting_approval`。

**检查点** `trace.checkpoint`（阶段 D）：任务生命周期标记，写入 trace 文件，便于恢复/审计。

| `checkpoint.kind` | 含义 | `resumable` |
| --- | --- | --- |
| `task_started` | 任务开始 | — |
| `shell_paused` | Shell 批准暂停，已写 disk checkpoint | `true` |
| `task_completed` | 正常结束 | — |
| `task_failed` | Loop 异常退出（route/handler catch） | — |

失败时若已有 `trace.linked`，会先 emit `trace.checkpoint(task_failed)` 再 `task.failed`，并写入 trace 文件。

`shell_paused` 含 `threadId` · `approvalId` · `command` · `iteration`。

### 2. `pty`（交互式 shell）

- **帧格式**（无 `event:` 行，兼容 `EventSource.onmessage`）：

```
data: {"type":"output","data":"..."}

data: {"type":"exit","exitCode":0}

```

类型：`PtyStreamEvent` = `output` | `exit`。

---

## `/health` 响应示例

```json
{
  "ok": true,
  "harness": {
    "version": "1.0",
    "routes": { "...": "见 harness.ts HARNESS_ROUTES" }
  },
  "pid": 12345,
  "uptimeMs": 60000,
  "loop": { "enabled": true, "path": "/loop", "stream": "agent-loop" },
  "pty": { "enabled": true, "path": "/pty", "stream": "pty" },
  "mcp": { "enabled": true, "connectedServers": 1, "toolCount": 29 }
}
```

---

## 客户端解析建议

1. 按 `\n\n` 拆 SSE 块。
2. Loop：找 `data:` 行 `JSON.parse` → `AgentEvent`；可选读 `event:` 做 fast-path。
3. PTY：仅 `data:` → `PtyStreamEvent`。
4. 远程 Loop：Next 透传 agent-server 字节流，帧格式不变。

---

## 与 Codex App Server 的关系

- **相似**：长驻 harness、事件流驱动 UI、工具/MCP 与控制面分离。
- **差异**：vec-next 用 HTTP+SSE（非 JSON-RPC）；事件类型为 `AgentEvent` 而非 Codex 原生 schema。
- **演进**：协议版本 bump 时递增 `HARNESS_PROTOCOL_VERSION`；旧客户端读 `harness.version` 降级。

---

## 相关 env

| 变量 | 说明 |
| --- | --- |
| `AGENT_SERVER_URL` | Next 代理 harness |
| `AGENT_LOOP_REMOTE=0` | Loop 留 Next，MCP/PTY 走 agent-server（`dev:desktop` 默认） |
| `AGENT_SERVER_PORT` | 默认 `3920` |

---

## 回归

```bash
npm run validate:harness-protocol
npm run validate:agent-server
```

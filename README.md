# Agent Workspace（Next.js）

任务型开发智能体 Web 应用：Agent Loop、工具调用、变更审批后执行。模型通过 **OpenAI 兼容 Chat Completions API** 调用（与旧版「聊天页」无关）。

## 环境变量

### GPT 中转

| 变量 | 说明 |
|------|------|
| `OPENAI_API_BASE` | 中转 `base_url` |
| `OPENAI_API_KEY` | API Key |
| `OPENAI_MODEL` | 文本模型 |
| `OPENAI_VISION_MODEL` | 识图模型（Agent 附图时使用） |

### 或 DeepSeek 官方

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-chat` |

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000) 即为 **Agent Workspace**。

## 主要结构

- `src/app/page.tsx` — Agent 工作区首页
- `src/components/agent-workspace.tsx` — 三栏 UI
- `src/components/agent-turn-block.tsx` — 每轮对话（用户气泡 + 推理 + 回答）
- `src/components/agent-turn-reasoning-timeline.tsx` — Cursor 式「已执行 X 秒」推理总折叠
- `src/agent/` — Agent Runtime（Loop、工具、审批、Trace）
- `src/app/api/agent/*` — Agent API
- `src/agent/model/chat-completions-provider.ts` — 模型调用（非聊天 UI）

## 文档

- [架构规划](docs/agent-architecture.md)
- [项目进度](docs/agent-progress.md)
- [开发准确度路线图（Cursor/Codex 对照）](docs/agent-accuracy-roadmap.md)
- [本地记忆 / 决策](docs/agent-memory.md)

## 部署到 Vercel

导入仓库后在 Environment Variables 填入上述变量即可 Deploy。

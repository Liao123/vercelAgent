# AI Chat × Vercel（Next.js）

通过 Next.js API 路由调用 **OpenAI 兼容接口**，支持：

- **GPT 中转**（填中转地址 + Key + 模型名）
- **DeepSeek 官方**（仅配置 `DEEPSEEK_API_KEY` 时自动使用）

## 环境变量

### 方式 A：GPT 中转（不使用 DeepSeek）

在 `.env.local` 或 Vercel 环境变量中配置：

| 变量 | 说明 | 示例 |
|------|------|------|
| `OPENAI_API_BASE` | 与 Codex `config.toml` 里 `base_url` 相同 | `https://queqiao.online` |
| `OPENAI_API_KEY` | 中转站提供的 Key | `sk-...` |
| `OPENAI_MODEL` | 模型名（以中转站文档为准） | `gpt-4o-mini` |

配置了 `OPENAI_API_BASE` + `OPENAI_API_KEY` 后，**不会**再走 DeepSeek。

### 方式 B：DeepSeek 官方

只配置：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-chat` |

## 本地运行

```bash
npm install
cp .env.example .env.local   # 按上面方式 A 或 B 填写
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

## 部署到 Vercel

1. 导入仓库到 [vercel.com/new](https://vercel.com/new)
2. 在 **Environment Variables** 填入上述变量（GPT 中转或 DeepSeek 二选一）
3. Deploy

## 项目结构

- `src/app/api/chat/route.ts` — 转发至 OpenAI 兼容 `/chat/completions`
- `src/components/chat.tsx` — 聊天界面
- `src/app/page.tsx` — 首页

/**
 * 应用首页（App Router 默认路由 `/`）
 * 服务端组件，仅负责布局与挂载聊天 UI
 */
import { Chat } from "@/components/chat";
import { AgentPanel } from "@/components/agent-panel";
import { BrowserPanel } from "@/components/browser-panel";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col items-center bg-zinc-100 px-4 py-10 dark:bg-zinc-950">
      {/* 页面标题区 */}
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          AI Chat × Vercel
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          鹊桥 GPT 中转 · 当前模型 GPT-5（
          {process.env.OPENAI_MODEL ?? "gpt-5.5"}）
        </p>
      </header>

      {/* 主内容：聊天、内置浏览器和开发智能体面板 */}
      <main className="grid w-full max-w-[1800px] flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,420px)_minmax(520px,1fr)_minmax(420px,520px)]">
        <Chat />
        <BrowserPanel />
        <AgentPanel />
      </main>
    </div>
  );
}

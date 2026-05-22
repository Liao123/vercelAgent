/**
 * 应用首页（App Router 默认路由 `/`）
 * 服务端组件，仅负责布局与挂载聊天 UI
 */
import { Chat } from "@/components/chat";

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

      {/* 主内容：聊天组件（客户端交互逻辑在 Chat 内） */}
      <main className="flex w-full flex-1 justify-center">
        <Chat />
      </main>
    </div>
  );
}

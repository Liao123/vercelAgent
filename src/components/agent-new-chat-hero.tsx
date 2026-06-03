"use client";

type AgentNewChatHeroProps = {
  workspaceName: string | null;
};

export function AgentNewChatHero({ workspaceName }: AgentNewChatHeroProps) {
  const label = workspaceName?.trim() || "项目";

  return (
    <div className="flex min-h-[min(360px,45vh)] flex-col items-center justify-center px-4 py-12 text-center">
      <h1 className="text-xl font-medium tracking-tight text-zinc-800 dark:text-zinc-100">
        该在 {label} 中做些什么？
      </h1>
      <p className="mt-2 text-[13px] text-zinc-500">
        输入框左下角可切换工作区，Enter 发送任务
      </p>
    </div>
  );
}

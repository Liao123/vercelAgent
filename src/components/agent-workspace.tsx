/**
 * Agent 工作区：左任务历史 · 中对话流+底栏输入 · 右规划+浏览器。
 */
"use client";

import { AgentPanel } from "@/components/agent-panel";
import { AgentWorkspaceBridgeProvider } from "@/components/agent-workspace-bridge";

export function AgentWorkspace() {
  return (
    <AgentWorkspaceBridgeProvider
      onOpenHistory={() => {
        /* 历史在左栏 Trace 列表 */
      }}
      onAfterRestore={() => {}}
    >
      <div className="flex h-screen overflow-hidden bg-zinc-100 dark:bg-zinc-950">
        <AgentPanel layout="triple" />
      </div>
    </AgentWorkspaceBridgeProvider>
  );
}

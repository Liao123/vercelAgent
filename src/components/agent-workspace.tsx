/**
 * Agent 工作区：左任务历史 · 中对话流+底栏输入 · 右规划+浏览器。
 */
"use client";

import { useEffect, useState } from "react";
import { AgentPanel } from "@/components/agent-panel";
import { AgentWorkspaceBridgeProvider } from "@/components/agent-workspace-bridge";
import { AgentDevDevelopPanel } from "@/components/agent-dev-develop-panel";
import { DesktopSetupBanner } from "@/components/desktop-setup-banner";
import {
  enableAgentDevModePersist,
  isAgentDevMode,
} from "@/lib/agent-dev-mode";

export function AgentWorkspace() {
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "1" || params.get("dev") === "true") {
      enableAgentDevModePersist();
    }
    setDevMode(isAgentDevMode());
  }, []);

  return (
    <AgentWorkspaceBridgeProvider
      onOpenHistory={() => {
        /* 历史在左栏 Trace 列表 */
      }}
      onAfterRestore={() => {}}
    >
      <div className="flex h-screen flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-950">
        <DesktopSetupBanner />
        {devMode && <AgentDevDevelopPanel />}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AgentPanel layout="triple" />
        </div>
      </div>
    </AgentWorkspaceBridgeProvider>
  );
}

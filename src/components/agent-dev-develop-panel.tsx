"use client";

import { useState } from "react";
import type { AgentEvent } from "@/agent/types";
import { ChevronIcon } from "@/components/chevron-icon";

type AgentDevDevelopPanelProps = {
  disabled?: boolean;
};

/** 仅 `?dev=1` 时挂载；默认折叠，不占主界面高度。 */
export function AgentDevDevelopPanel({
  disabled = false,
}: AgentDevDevelopPanelProps) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function runDevelop() {
    const userRequest = request.trim();
    if (!userRequest || running || disabled) return;

    setRunning(true);
    setError(null);
    setLog(["启动 develop 闭环…"]);

    try {
      const res = await fetch("/api/agent/develop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRequest, verify: true }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let event: AgentEvent;
          try {
            event = JSON.parse(line.slice(6)) as AgentEvent;
          } catch {
            continue;
          }
          const lineText = formatDevEvent(event);
          if (lineText) {
            setLog((prev) => [...prev.slice(-40), lineText]);
          }
          if (event.type === "task.failed") {
            setError(event.error);
          }
        }
      }
      setLog((prev) => [...prev, "develop 流结束"]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "develop 失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[10px] font-medium text-amber-900 dark:text-amber-200"
        aria-expanded={open}
      >
        <ChevronIcon
          variant="dropdown"
          expanded={open}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">
          开发者 · develop 闭环（非 Agent Loop）
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-200/60 px-3 pb-2 pt-1 dark:border-amber-900/40">
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={running || disabled}
            rows={2}
            placeholder="调试：输入需求，走 /api/agent/develop"
            className="w-full rounded border border-amber-200 bg-white px-2 py-1 text-[11px] dark:border-amber-800 dark:bg-zinc-950"
          />
          <button
            type="button"
            disabled={running || disabled || !request.trim()}
            onClick={() => void runDevelop()}
            className="mt-1 w-full rounded bg-amber-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {running ? "运行中…" : "运行 develop"}
          </button>
          {error && (
            <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          {log.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-auto rounded bg-white/80 p-1 font-mono text-[9px] text-amber-950 dark:bg-black/30 dark:text-amber-100">
              {log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function formatDevEvent(event: AgentEvent): string | null {
  switch (event.type) {
    case "task.created":
      return `task.created ${event.taskId}`;
    case "tool.completed":
      return `tool ${event.toolCall.toolName}`;
    case "approval.required":
      return `approval ${event.approval.title}`;
    case "task.completed":
      return `done: ${event.summary.slice(0, 120)}`;
    case "task.failed":
      return `failed: ${event.error}`;
    default:
      return null;
  }
}

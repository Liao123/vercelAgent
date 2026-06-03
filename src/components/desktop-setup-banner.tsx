"use client";

import { useCallback, useEffect, useState } from "react";
import { openDesktopConfigDirectory } from "@/lib/desktop-bridge";
import { useDesktopApp } from "@/lib/use-desktop-app";

type SetupStatus = {
  modelConfigured?: boolean;
  envLocalExists?: boolean;
  envExampleExists?: boolean;
  configDir?: string;
};

export function DesktopSetupBanner() {
  const desktop = useDesktopApp();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const res = await fetch("/api/agent/desktop/setup", { cache: "no-store" });
      if (!res.ok) return;
      setStatus((await res.json()) as SetupStatus);
      setError(null);
    } catch {
      // ignore
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function seedEnvLocal() {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/desktop/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed-env" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setSeeding(false);
    }
  }

  if (!desktop) return null;
  if (status === null) return null;
  if (status.modelConfigured) return null;

  const configDir = status.configDir;

  return (
    <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/90 px-4 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
      <p className="text-center text-[11px] font-medium text-amber-900 dark:text-amber-200">
        首次使用 · 配置模型 API
      </p>
      <ol className="mx-auto mt-1.5 max-w-md list-decimal space-y-0.5 pl-4 text-left text-[10px] text-amber-900/90 dark:text-amber-200/90">
        {!status.envLocalExists && (
          <li>点击下方「生成 .env.local」从模板创建配置文件</li>
        )}
        <li>
          在{" "}
          <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">
            .env.local
          </code>{" "}
          中填写 <code className="rounded px-0.5">OPENAI_API_BASE</code> 与{" "}
          <code className="rounded px-0.5">OPENAI_API_KEY</code>
        </li>
        <li>保存后点「重新加载」</li>
      </ol>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {!status.envLocalExists && status.envExampleExists && (
          <button
            type="button"
            disabled={seeding}
            onClick={() => void seedEnvLocal()}
            className="rounded-md bg-amber-800 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-700"
          >
            {seeding ? "生成中…" : "生成 .env.local"}
          </button>
        )}
        {configDir && (
          <button
            type="button"
            onClick={() => void openDesktopConfigDirectory(configDir)}
            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[10px] text-amber-900 hover:bg-amber-100/80 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-100"
          >
            打开配置目录
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[10px] text-amber-900 hover:bg-amber-100/80 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-100"
        >
          重新加载
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-center text-[10px] text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

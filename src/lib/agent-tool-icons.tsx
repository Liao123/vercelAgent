/** 工具步骤图标，供时间线与执行细节共用。 */
import type { ReactNode } from "react";

export function agentToolIcon(toolName?: string): ReactNode {
  const className = "h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500";

  if (!toolName) {
    return (
      <svg
        viewBox="0 0 16 16"
        className={className}
        fill="currentColor"
        aria-hidden
      >
        <circle cx="8" cy="8" r="2.5" />
      </svg>
    );
  }

  if (toolName === "tool.search") {
    return (
      <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden>
        <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M9.8 9.8 13 13"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (toolName.startsWith("file.") || toolName === "patch.prepare") {
    return (
      <svg
        viewBox="0 0 16 16"
        className={className}
        fill="currentColor"
        aria-hidden
      >
        <path d="M4 2h5.5L13 5.5V14H4V2zm6 0v3h3" />
      </svg>
    );
  }

  if (toolName.startsWith("git.")) {
    return (
      <svg
        viewBox="0 0 16 16"
        className={className}
        fill="currentColor"
        aria-hidden
      >
        <path
          d="M6 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm4 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6 13l4-4"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    );
  }

  if (
    toolName === "browser.open" ||
    toolName === "browser.inspect" ||
    toolName === "browser.query"
  ) {
    return (
      <svg
        viewBox="0 0 16 16"
        className={className}
        fill="currentColor"
        aria-hidden
      >
        <circle
          cx="8"
          cy="8"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M2.5 8h11M8 2.5c1.5 1.8 2.3 3.7 2.3 5.5S9.5 11.2 8 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    );
  }

  if (toolName.startsWith("shell.") || toolName === "project.index") {
    return (
      <svg
        viewBox="0 0 16 16"
        className={className}
        fill="currentColor"
        aria-hidden
      >
        <path
          d="M4 4h8v8H4V4zm1.5 2.5L7 8l-1.5 1.5M9 10h2"
          stroke="currentColor"
          strokeWidth="1.1"
          fill="none"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function agentToolFileName(
  toolName: string,
  args: unknown,
  result: unknown,
): string | null {
  const paths: string[] = [];

  const collectPath = (value: unknown) => {
    if (typeof value === "string" && value.includes("/")) paths.push(value);
    if (typeof value === "string" && value.includes("\\")) paths.push(value);
  };

  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    collectPath(record.path);
    collectPath(record.filePath);
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    collectPath(record.path);
    if (Array.isArray(record.candidates)) {
      for (const item of record.candidates.slice(0, 1)) {
        if (item && typeof item === "object") {
          collectPath((item as Record<string, unknown>).path);
        }
      }
    }
  }

  if (paths.length === 0) return null;
  const full = paths[0]!;
  const segments = full.split(/[/\\]/);
  return segments[segments.length - 1] || full;
}

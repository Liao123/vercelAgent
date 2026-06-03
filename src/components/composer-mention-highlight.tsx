"use client";

import { parseRequestSegments } from "@/lib/composer-at-mention";

const INPUT_CLASS =
  "min-h-[44px] px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap break-words";

type ComposerMentionHighlightProps = {
  text: string;
  className?: string;
};

/** 与 textarea 同字同宽着色，避免短标签 + 长透明字造成空白占位。 */
export function ComposerMentionHighlight({
  text,
  className = "",
}: ComposerMentionHighlightProps) {
  const segments = parseRequestSegments(text);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${INPUT_CLASS} ${className}`}
      aria-hidden
    >
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <span key={`t-${index}`} className="text-zinc-900 dark:text-zinc-100">
              {segment.value}
            </span>
          );
        }
        const token = `@${segment.path}`;
        return (
          <span
            key={`m-${index}-${segment.path}`}
            className="inline whitespace-pre rounded-sm bg-sky-100/90 text-sky-800 ring-1 ring-sky-200/80 dark:bg-sky-950/70 dark:text-sky-100 dark:ring-sky-800/80"
            title={segment.path}
          >
            {token}
          </span>
        );
      })}
    </div>
  );
}

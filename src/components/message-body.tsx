"use client";

import { useEffect, useState } from "react";
import { needsImageProxy, toDisplayImageSrc } from "@/lib/image-src";

type MessageBodyProps = {
  content: string;
  images?: string[];
};

function ChatImage({ src, index }: { src: string; index: number }) {
  const proxiedSrc = toDisplayImageSrc(src);
  const shouldPostProxy = needsImageProxy(src) && proxiedSrc.length > 1800;
  const [blobSrc, setBlobSrc] = useState<{ source: string; url: string } | null>(
    null,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const displaySrc =
    shouldPostProxy && blobSrc?.source === src ? blobSrc.url : proxiedSrc;
  const failed = failedSrc === src;
  const loading = shouldPostProxy && blobSrc?.source !== src && !failed;

  useEffect(() => {
    if (!shouldPostProxy) return;

    let revoked: string | undefined;
    let cancelled = false;

    async function loadViaPostProxy() {
      try {
        const res = await fetch("/api/image-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: src }),
        });
        if (!res.ok) throw new Error("proxy failed");

        const blob = await res.blob();
        revoked = URL.createObjectURL(blob);
        if (!cancelled) setBlobSrc({ source: src, url: revoked });
      } catch {
        if (!cancelled) setFailedSrc(src);
      }
    }

    void loadViaPostProxy();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [shouldPostProxy, src]);

  if (failed) {
    return (
      <p className="break-all px-2 py-2 text-xs text-red-600 dark:text-red-400">
        图片 {index + 1} 加载失败
        {!src.startsWith("data:") && (
          <>
            ，请
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline"
            >
              在新标签页打开链接
            </a>
          </>
        )}
      </p>
    );
  }

  if (loading) {
    return (
      <p className="px-2 py-8 text-center text-sm text-zinc-500 animate-pulse">
        图片生成中，请稍候...
      </p>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displaySrc}
      alt={`生成图片 ${index + 1}`}
      className="max-h-[480px] w-full object-contain bg-zinc-100 dark:bg-zinc-800"
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

export function MessageBody({ content, images = [] }: MessageBodyProps) {
  const hasText = content.trim().length > 0;
  const hasImages = images.length > 0;

  if (!hasText && !hasImages) {
    return <p className="text-zinc-500 italic">（空回复）</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {hasText && (
        <p className="whitespace-pre-wrap break-words">{content}</p>
      )}
      {hasImages && (
        <div className="flex flex-col gap-2">
          {images.map((imageSrc, i) => (
            <figure
              key={i}
              className={`overflow-hidden rounded-lg border ${
                imageSrc.startsWith("data:")
                  ? "border-white/30"
                  : "border-zinc-200 dark:border-zinc-700"
              }`}
            >
              <ChatImage src={imageSrc} index={i} />
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

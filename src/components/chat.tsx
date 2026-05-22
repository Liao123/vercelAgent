/**
 * 聊天 UI：文本对话、上传图片解析（vision）、生成图片
 */
"use client";

import { FormEvent, useRef, useState } from "react";
import { MessageBody } from "@/components/message-body";
import type { ChatMessage } from "@/lib/chat-types";
import { isImageGenerationRequest } from "@/lib/image-intent";
import { readImageFile } from "@/lib/read-image-file";
import { toApiMessages } from "@/lib/to-api-messages";

const MAX_ATTACHMENTS = 4;

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    setError(null);
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const toAdd = Array.from(files).slice(0, remaining);

    try {
      const urls = await Promise.all(toAdd.map((f) => readImageFile(f)));
      setAttachments((prev) => [...prev, ...urls].slice(0, MAX_ATTACHMENTS));
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片读取失败");
    } finally {
      e.target.value = "";
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || loading) return;

    const isGenerateImage =
      !hasAttachments && isImageGenerationRequest(text);

    const userMessage: ChatMessage = {
      role: "user",
      content: text || (hasAttachments ? "请分析我上传的图片" : ""),
      images: hasAttachments ? [...attachments] : undefined,
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setAttachments([]);
    setLoading(true);
    setLoadingImage(isGenerateImage);
    setError(null);

    try {
      const res = await fetch(isGenerateImage ? "/api/images" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isGenerateImage
            ? { prompt: text }
            : { messages: toApiMessages(nextMessages) },
        ),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "请求失败");
      }

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: data.content ?? "",
          images: Array.isArray(data.images) ? data.images : [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
      setMessages(messages);
      setAttachments(userMessage.images ?? []);
      setInput(text);
    } finally {
      setLoading(false);
      setLoadingImage(false);
    }
  }

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !loading;

  return (
    <div className="flex h-full min-h-0 w-full max-w-2xl flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            可聊天、上传图片让 GPT 解析，或输入「生成一张皮鞋图」绘图
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
              msg.role === "user"
                ? "ml-8 bg-blue-600 text-white"
                : "mr-8 bg-white text-zinc-800 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
            }`}
          >
            <span className="mb-1 block text-xs font-medium opacity-70">
              {msg.role === "user" ? "你" : "助手"}
            </span>
            <MessageBody content={msg.content} images={msg.images} />
          </div>
        ))}
        {loading && (
          <p className="text-sm text-zinc-500 animate-pulse">
            {loadingImage
              ? "正在生成图片，约需 10–30 秒…"
              : "思考中…"}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((src, i) => (
            <div key={i} className="relative">
              <img
                src={src}
                alt={`待发送图片 ${i + 1}`}
                className="h-16 w-16 rounded-lg border border-zinc-300 object-cover"
              />
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white"
                aria-label="移除图片"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={onPickImages}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || attachments.length >= MAX_ATTACHMENTS}
          title="上传图片"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          图片
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题，或上传图片后提问…"
          disabled={loading}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </div>
  );
}

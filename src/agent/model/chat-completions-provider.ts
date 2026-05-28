/**
 * OpenAI Chat Completions 兼容模型适配器。
 *
 * 当前项目已有 OpenAI 兼容中转和 DeepSeek 配置，所以先用这个 provider
 * 承接现有 /api/chat 能力。后续可再加 Responses API 或其他模型 provider。
 */
import { extractAssistantText } from "@/lib/extract-assistant-text";
import type { ApiConfig } from "@/lib/openai-config";
import { parseAssistantPayload } from "@/lib/parse-message";
import type {
  CompactInput,
  CompactOutput,
  ModelInput,
  ModelOutput,
  ModelProvider,
  ModelStreamEvent,
} from "@/agent/model/types";

type ChatCompletionChoice = {
  message?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  finish_reason?: string;
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  error?: { message?: string };
};

export class ChatCompletionsProvider implements ModelProvider {
  name: string;

  constructor(private readonly config: ApiConfig) {
    this.name = config.provider;
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    const model = input.model ?? this.config.chatModel;
    const response = await fetch(this.config.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        stream: false,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`${this.config.provider} API error: ${rawText}`);
    }

    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("Model API returned invalid JSON.");
    }

    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    const choice = data.choices?.[0];
    const message = choice?.message;
    const rawContent = message?.content;
    const { text, images } = parseAssistantPayload(rawContent);
    const content = text || extractAssistantText(message);

    if (!content) {
      const reason = choice?.finish_reason ?? "unknown";
      throw new Error(`Model returned empty content. finish_reason: ${reason}`);
    }

    return {
      content,
      images,
      model,
      finishReason: choice?.finish_reason,
      rawContent,
      raw: data,
    };
  }

  async *stream(input: ModelInput): AsyncIterable<ModelStreamEvent> {
    const model = input.model ?? this.config.chatModel;
    const response = await fetch(this.config.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        stream: true,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }),
    });

    if (!response.ok) {
      yield { type: "error", error: await response.text() };
      return;
    }

    if (!response.body) {
      yield { type: "error", error: "Model API returned no stream body." };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") continue;

        let data: ChatCompletionResponse;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = data.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { type: "delta", text: delta, raw: data };
        }
      }
    }

    yield { type: "completed" };
  }

  async compact(input: CompactInput): Promise<CompactOutput> {
    const model = this.config.chatModel;
    const output = await this.generate({
      messages: [
        {
          role: "system",
          content: [
            "You merge coding-agent history into compact memory for the next model turn.",
            "Output plain text with exactly these sections (no other headings):",
            "## Summary",
            "- Bullet points: tools used, files read/changed, approvals prepared (include approval_* ids verbatim), errors, blockers, what is still pending for the user.",
            "## Changed files",
            "- One repo-relative path per line prefixed with '- ', or a single line: - none",
            "Rules:",
            "- Copy every approval_* id from Pinned facts into Summary; never drop or rename them.",
            "- Do not invent paths, commands, or approval ids.",
            "- Collapse repeated file.read of the same path into one note.",
            "- Keep branch names and git commands if present in steps.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `User task:\n${input.userRequest}`,
            input.pinnedFacts ? `\nPinned facts (authoritative):\n${input.pinnedFacts}` : "",
            input.priorMemory
              ? `\nPrior compacted memory:\n${input.priorMemory}`
              : "",
            `\nNew steps to merge:\n${JSON.stringify(input.sections, null, 2)}`,
          ].join("\n"),
        },
      ],
      model,
      maxTokens: input.maxTokens ?? 1_100,
      temperature: 0,
    });

    return { summary: output.content.trim(), model: output.model };
  }
}

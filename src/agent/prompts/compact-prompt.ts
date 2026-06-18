import { loadPromptFile } from "@/agent/prompts/load-prompt";

let cachedCompactPrompt: string | null = null;

export function getCompactSystemPrompt(): string {
  if (!cachedCompactPrompt) {
    cachedCompactPrompt = loadPromptFile("compact.md");
  }
  return cachedCompactPrompt;
}

/** 剥离 <analysis> 草稿，提取 <summary> 正文（对齐 Claude Code formatCompactSummary） */
export function formatCompactModelOutput(raw: string): string {
  let text = raw.trim();
  text = text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim();
  }
  return text;
}

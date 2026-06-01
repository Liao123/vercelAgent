import { extractFinalSummaryFromModelText } from "@/lib/parse-agent-final";

function unescapeJsonFragment(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractJsonStringField(text: string, field: string): string | null {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`,);
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  return unescapeJsonFragment(match[1]).trim();
}

/** 运行中从尚未闭合的 model.delta JSON 里抠出 partial summary / plannedNext。 */
export function extractStreamingPreviewFromModelText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const finalSummary = extractFinalSummaryFromModelText(trimmed);
  if (finalSummary) return finalSummary;

  const summary = extractJsonStringField(trimmed, "summary");
  if (summary) return summary;

  const plannedNext = extractJsonStringField(trimmed, "plannedNext");
  if (plannedNext) return plannedNext;

  const understanding = extractJsonStringField(trimmed, "understanding");
  if (understanding) return understanding;

  return null;
}

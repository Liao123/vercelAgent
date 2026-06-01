/** 从 model.delta 文本里提取 action=final 的 summary（Loop JSON 协议）。 */
export function extractFinalSummaryFromModelText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const candidate of extractJsonObjectCandidates(trimmed)) {
    try {
      const parsed = JSON.parse(candidate) as { action?: string; summary?: string };
      if (parsed.action === "final" && typeof parsed.summary === "string") {
        return parsed.summary.trim();
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  if (candidates.length === 0 && text.trim().startsWith("{")) {
    candidates.push(text.trim());
  }

  return candidates;
}

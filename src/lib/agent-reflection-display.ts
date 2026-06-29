const DEFAULT_MAX_REFLECTION_CHARS = 150;

export function stripInternalPlanLines(text: string): string {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^计划\s*[:：]/u.test(line))
    .join(" ");
}

export function compactReflectionText(
  text: string,
  maxChars = DEFAULT_MAX_REFLECTION_CHARS,
): string {
  const clean = stripInternalPlanLines(text)
    .replace(/\s+/g, " ")
    .replace(/^(理解|打算|下一步)\s*[:：]\s*/u, "")
    .trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * 零成本运行时事实（日历等），非仓库证据。
 */
export function formatRuntimeFactsForPrompt(
  now: Date = new Date(),
  timeZone = "Asia/Shanghai",
): string {
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    dateStyle: "long",
  });
  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return [
    "[RUNTIME_FACTS — calendar clock only; NOT proof for repo edits or factual QA about the codebase]",
    `Local date (${timeZone}): ${dateFormatter.format(now)}`,
    `Local time (${timeZone}): ${timeFormatter.format(now)}`,
    "For calendar questions you may answer from RUNTIME_FACTS; for repo facts still file.read / gather.",
  ].join("\n");
}

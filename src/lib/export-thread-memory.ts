export function buildThreadMemoryMarkdown(
  title: string,
  memoryContent: string,
  meta?: { threadId?: string; round?: number; method?: string },
): string {
  const header = [
    `# Agent 会话记忆：${title}`,
    "",
    meta?.threadId ? `- Thread: \`${meta.threadId}\`` : "",
    meta?.round != null ? `- 压缩轮次: ${meta.round}` : "",
    meta?.method ? `- 方式: ${meta.method}` : "",
    `- 导出时间: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}\`\`\`\n${memoryContent}\n\`\`\`\n`;
}

export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/markdown;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

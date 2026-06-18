import fs from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.join(process.cwd(), "src/agent/prompts");

export function loadPromptFile(fileName: string): string {
  const filePath = path.join(PROMPTS_DIR, fileName);
  return fs.readFileSync(filePath, "utf8").trimEnd();
}

export function renderPrompt(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /\{\{([A-Z0-9_]+)\}\}/g,
    (_, key: string) => variables[key] ?? "",
  );
}

/** 去掉因空占位符产生的多余空行 */
export function normalizePromptWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

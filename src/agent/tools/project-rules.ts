/**
 * 项目规则读取工具。
 *
 * 负责读取 AGENTS.md、README、CLAUDE.md 等长期规则文件。
 * 这些内容会进入 Project Context，影响后续 agent 行为。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readTextFile } from "@/agent/tools/file-tools";
import { toWorkspaceRelative } from "@/agent/tools/path-safety";

export type ProjectRuleFile = {
  path: string;
  content: string;
  truncated: boolean;
  scopePath: string;
  depth: number;
  source: "AGENTS.md" | "README.md" | "CLAUDE.md";
};

const ROOT_RULE_FILES = ["README.md", "CLAUDE.md"] as const;
const IGNORED_RULE_DIRS = new Set([
  ".git",
  ".next",
  ".agent-state",
  ".agent-traces",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

async function readRuleFile(
  rootPath: string,
  relativePath: string,
  source: ProjectRuleFile["source"],
): Promise<ProjectRuleFile | null> {
  try {
    const result = await readTextFile(rootPath, relativePath, 80_000);
    const scopePath =
      source === "AGENTS.md"
        ? path.posix.dirname(result.path).replace(/^\.$/, "")
        : "";
    const depth = scopePath ? scopePath.split("/").length : 0;
    return {
      path: result.path,
      content: result.content,
      truncated: result.truncated,
      scopePath,
      depth,
      source,
    };
  } catch {
    return null;
  }
}

async function findAgentRuleFiles(rootPath: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_RULE_DIRS.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile() && entry.name === "AGENTS.md") {
        found.push(toWorkspaceRelative(rootPath, absolutePath));
      }
    }
  }

  await visit(rootPath);
  return found.sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });
}

export async function readProjectRules(
  rootPath: string,
): Promise<ProjectRuleFile[]> {
  const rules: ProjectRuleFile[] = [];

  for (const agentFile of await findAgentRuleFiles(rootPath)) {
    const rule = await readRuleFile(rootPath, agentFile, "AGENTS.md");
    if (rule) rules.push(rule);
  }

  for (const fileName of ROOT_RULE_FILES) {
    const rule = await readRuleFile(rootPath, fileName, fileName);
    if (rule) rules.push(rule);
  }

  return rules;
}

export function selectProjectRulesForPath(
  rules: ProjectRuleFile[],
  relativePath: string,
): ProjectRuleFile[] {
  const normalizedPath = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const selected = rules.filter((rule) => {
    if (rule.source !== "AGENTS.md") return rule.scopePath === "";
    if (!rule.scopePath) return true;
    return (
      normalizedPath === rule.scopePath ||
      normalizedPath.startsWith(`${rule.scopePath}/`)
    );
  });

  return selected.sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === "README.md") return -1;
      if (b.source === "README.md") return 1;
      if (a.source === "CLAUDE.md") return -1;
      if (b.source === "CLAUDE.md") return 1;
    }
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.path.localeCompare(b.path);
  });
}

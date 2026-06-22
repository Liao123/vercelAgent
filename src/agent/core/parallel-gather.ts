/**
 * 单轮并行 gather（A149）：独立只读工具可 Promise.all，不写死场景。
 */
import { GATHER_EVIDENCE_TOOLS } from "@/agent/core/evidence-gate";

const BROWSER_GATHER_TOOLS = new Set([
  "browser.inspect",
  "browser.wait_and_inspect",
  "browser.open",
]);

/** 可与其他 gather 并行执行的只读工具（无写盘 / prepare）。 */
export const PARALLEL_GATHER_TOOLS = new Set([
  "workspace.inspect",
  "file.locate",
  "ui.trace_from_page",
  "file.list",
  "file.read",
  "file.search",
  "jsx.find_text",
  "symbol.find_references",
  "git.status",
  "git.diff",
]);

const PATH_ARG_KEYS = ["path", "file", "filePath", "targetPath"] as const;

function extractPath(args: Record<string, unknown>): string | null {
  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replaceAll("\\", "/");
    }
  }
  return null;
}

export function isParallelGatherEnabled(): boolean {
  return process.env.AGENT_LOOP_PARALLEL_GATHER !== "0";
}

/**
 * 同一 assistant 轮的多个 tool_call 是否可并行执行。
 * 要求：全部为并行安全 gather；无 browser；file.read 路径互不重复。
 */
export function canParallelizeGatherBatch(
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
): boolean {
  if (!isParallelGatherEnabled()) return false;
  if (toolCalls.length <= 1) return false;

  if (!toolCalls.every((call) => PARALLEL_GATHER_TOOLS.has(call.name))) {
    return false;
  }
  if (!toolCalls.every((call) => GATHER_EVIDENCE_TOOLS.has(call.name))) {
    return false;
  }
  if (toolCalls.some((call) => BROWSER_GATHER_TOOLS.has(call.name))) {
    return false;
  }
  if (toolCalls.filter((call) => call.name === "project.index").length > 1) {
    return false;
  }

  const readPaths = new Set<string>();
  for (const call of toolCalls) {
    if (call.name !== "file.read") continue;
    const path = extractPath(call.args);
    if (!path) return false;
    if (readPaths.has(path)) return false;
    readPaths.add(path);
  }

  return true;
}

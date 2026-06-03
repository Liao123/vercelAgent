/**
 * 模型循环结束仍未产出审批时，用磁盘证据做最后一次通用恢复（不解析中文句式）。
 */
import {
  locateFilesForRequest,
  buildProjectIndex,
  traceUiEntryForQuery,
} from "@/agent/indexer";
import { prepareFileMutation, readTextFile, searchText } from "@/agent/tools";
import { buildPrepareEvidenceFromSearch } from "@/agent/approval/prepare-evidence";
import { isLikelyCodeEditRequest } from "@/agent/core/agent-loop-state";
import { shouldSkipEditRecoveryForUiPrepare } from "@/agent/core/ui-prepare-nudge";
import type { AgentUiContext } from "@/agent/types";
import type { ApprovalRequest } from "@/agent/types";

export type EditRecoveryResult =
  | {
      ok: true;
      path: string;
      search: string;
      replace: string;
      approval: ApprovalRequest;
      strategy: string;
    }
  | {
      ok: false;
      message: string;
      triedPaths: string[];
      triedTokens: string[];
    };

function isDeleteIntent(request: string): boolean {
  return /(删除|移除|去掉|去除|删掉|remove|delete)/i.test(request);
}

/** 从需求中提取可能在文件里出现的字面量（数字、引号内文字、英文词），不整句猜。 */
export function extractLiteralCandidates(request: string): string[] {
  const tokens: string[] = [];
  const priority: string[] = [];
  if (isDeleteIntent(request)) {
    if (/闭环/.test(request)) priority.push("闭环");
    if (/Loop/.test(request) || /\bloop\b/i.test(request)) priority.push("Loop");
  }

  for (const match of request.matchAll(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/g)) {
    const value = match[1]?.trim();
    if (value) tokens.push(value);
  }
  for (const match of request.matchAll(/\d+/g)) {
    tokens.push(match[0]);
  }
  for (const match of request.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g)) {
    const token = match[0];
    if (token.length < 3) continue;
    if (
      /^(approval|prepare|action|final|file|read|write|tool|route|tsx|jsx|ui)$/i.test(
        token,
      )
    ) {
      continue;
    }
    tokens.push(token);
  }

  return [...new Set([...priority, ...tokens])].sort(
    (left, right) => right.length - left.length,
  );
}

async function resolveTargetPaths(
  rootPath: string,
  userRequest: string,
  filesAlreadyRead: string[],
  uiContext?: AgentUiContext,
): Promise<string[]> {
  const ordered: string[] = [];
  const seen = new Set<string>();

  function add(filePath: string) {
    const normalized = filePath.replaceAll("\\", "/");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  }

  for (const filePath of filesAlreadyRead) {
    add(filePath);
  }

  try {
    const uiTrace = await traceUiEntryForQuery(rootPath, userRequest, uiContext);
    if (uiTrace) {
      for (const filePath of uiTrace.suggestedReadOrder.slice(0, 10)) {
        add(filePath);
      }
    }
  } catch {
    // Trace failures should not block recovery.
  }

  if (/(首页|主页|home\s*page|landing)/i.test(userRequest)) {
    add("src/app/page.tsx");
  }

  try {
    const index = await buildProjectIndex(rootPath);
    const located = locateFilesForRequest(index, userRequest, 8, uiContext);
    for (const candidate of located.candidates) {
      if (
        candidate.file.kind === "page" ||
        candidate.file.kind === "component"
      ) {
        add(candidate.file.filePath);
      }
    }
  } catch {
    // Index failures should not block recovery.
  }

  if (ordered.length === 0) {
    add("src/app/page.tsx");
  }

  return ordered;
}

function pickTokenInContent(content: string, tokens: string[]): string | null {
  for (const token of tokens) {
    if (token.length > 0 && content.includes(token)) {
      return token;
    }
  }
  return null;
}

export async function tryRecoverEditApproval(input: {
  rootPath: string;
  taskId: string;
  userRequest: string;
  filesRead?: string[];
  uiContext?: AgentUiContext;
  /** A083：UI 已具备 prepare 证据时跳过 recovery */
  skipRecovery?: boolean;
}): Promise<EditRecoveryResult | null> {
  if (input.skipRecovery) return null;
  if (!isLikelyCodeEditRequest(input.userRequest)) return null;
  if (!isDeleteIntent(input.userRequest)) return null;

  const tokens = extractLiteralCandidates(input.userRequest);
  const targetPaths = await resolveTargetPaths(
    input.rootPath,
    input.userRequest,
    input.filesRead ?? [],
    input.uiContext,
  );

  if (tokens.length === 0) {
    return {
      ok: false,
      message:
        "未能从需求中提取可在文件中搜索的字面量（如数字、英文或引号内文字）。请说明要删的精确文字，或先让智能体 read 目标文件。",
      triedPaths: targetPaths,
      triedTokens: [],
    };
  }

  for (const relativePath of targetPaths) {
    let content: string;
    let path: string;
    try {
      const file = await readTextFile(input.rootPath, relativePath, 500_000);
      content = file.content;
      path = file.path;
    } catch {
      continue;
    }

    let search = pickTokenInContent(content, tokens);

    if (!search) {
      for (const token of tokens) {
        if (token.length < 2) continue;
        const matches = await searchText(input.rootPath, token, 20);
        const inFile = matches.find((match) => match.path === path);
        if (inFile) {
          search = token;
          break;
        }
      }
    }

    if (!search || !content.includes(search)) continue;

    const index = content.indexOf(search);
    const nextContent = `${content.slice(0, index)}${content.slice(
      index + search.length,
    )}`;

    if (nextContent === content) continue;

    const evidence = buildPrepareEvidenceFromSearch({
      path,
      content,
      search,
      source: "file.replace.prepare",
    });

    const prepared = await prepareFileMutation({
      rootPath: input.rootPath,
      taskId: input.taskId,
      operation: {
        type: "write",
        path,
        content: nextContent,
      },
      createApproval: true,
      evidence,
    });

    if (!prepared.approval) continue;

    return {
      ok: true,
      path,
      search,
      replace: "",
      approval: prepared.approval,
      strategy: `disk_recovery:remove "${search}" from ${path}`,
    };
  }

  return {
    ok: false,
    message: `在候选文件中未找到可删除的字面量：${tokens.join(", ")}。请确认页面实际文案（例如当前可能是「123GPT」而不是「123文字」）。`,
    triedPaths: targetPaths,
    triedTokens: tokens,
  };
}

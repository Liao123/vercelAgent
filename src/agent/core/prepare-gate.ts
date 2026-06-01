/**
 * prepare 类工具硬门禁：改前须有 file.read 证据；UI 意图须先 trace/locate。
 */
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import type { AgentUiContext } from "@/agent/types";

export type PrepareGateInput = {
  toolName: string;
  /** 须已 file.read 的路径（新建文件可列入 exemptPaths 跳过） */
  requiredReadPaths: string[];
  exemptReadPaths?: string[];
  runState: AgentLoopRunState;
  uiContext?: AgentUiContext;
};

export function normalizeWorkspacePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

/** 与 ui-entry-tracer / file-locator 的 UI 意图检测一致。 */
export function isUiLocationQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return (
    /首页|主页|homepage|landing/.test(normalized) ||
    /去掉|删除|移除|隐藏|显示|按钮|选择|切换|左边|左侧|右边|右侧|界面|组件|样式|布局|tab|菜单/.test(
      normalized,
    )
  );
}

export function hasUiLocationEvidence(toolsCalled: string[]): boolean {
  return toolsCalled.some(
    (tool) => tool === "ui.trace_from_page" || tool === "file.locate",
  );
}

function readSet(runState: AgentLoopRunState): Set<string> {
  return new Set(runState.filesRead.map(normalizeWorkspacePath));
}

export function assertPrepareGate(input: PrepareGateInput): void {
  const { runState, requiredReadPaths, exemptReadPaths = [] } = input;
  const exempt = new Set(exemptReadPaths.map(normalizeWorkspacePath));
  const read = readSet(runState);
  const uiIntent = isUiLocationQuery(runState.userRequest);

  if (uiIntent) {
    if (!hasUiLocationEvidence(runState.toolsCalled)) {
      throw new Error(
        "UI/首页改动须先调用 ui.trace_from_page 或 file.locate，再 file.read 目标文件，最后 prepare。",
      );
    }

    if (runState.disambiguation) {
      const unread = runState.disambiguation.mustReadPaths.filter(
        (path) => !read.has(normalizeWorkspacePath(path)),
      );
      if (unread.length > 0) {
        throw new Error(
          `多候选消歧：须先 file.read 全部候选（${unread.join("、")}），再 prepare。推荐：${runState.disambiguation.recommendedPath}。${runState.disambiguation.selectionRationale}`,
        );
      }
    }

    for (const rawPath of requiredReadPaths) {
      const filePath = normalizeWorkspacePath(rawPath);
      if (filePath.startsWith("src/agent/core/")) {
        throw new Error(
          `UI 改动不应修改 agent 运行时 ${filePath}。请沿页面组件树改 src/components/* 或 src/app/*。`,
        );
      }
    }
  }

  for (const rawPath of requiredReadPaths) {
    const filePath = normalizeWorkspacePath(rawPath);
    if (!filePath || exempt.has(filePath)) continue;
    if (!read.has(filePath)) {
      throw new Error(
        `prepare 被拒绝：须先 file.read「${filePath}」并在磁盘上确认 exact 文本，再调用 ${input.toolName}。`,
      );
    }
  }
}

/** 从 unified diff 提取须已 read 的既有文件路径（仅 --- a/ 侧，跳过 /dev/null 新建）。 */
export function extractExistingPatchPaths(patch: string): string[] {
  const paths = new Set<string>();

  for (const match of patch.matchAll(/^--- a\/(.+)$/gm)) {
    const value = match[1]?.trim();
    if (value && value !== "/dev/null") {
      paths.add(normalizeWorkspacePath(value));
    }
  }

  return [...paths];
}

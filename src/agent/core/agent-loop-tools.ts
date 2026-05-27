/**
 * Agent Loop 工具注册表。
 *
 * Agent Loop 可调用只读/低风险工具，也可以为文件变更和 Git 写操作准备审批。
 * prepare 类工具只创建 approval，不直接 apply。
 */
import { openBrowserUrl } from "@/agent/browser";
import {
  buildProjectIndex,
  locateFilesForRequest,
  type ProjectIndex,
} from "@/agent/indexer";
import {
  getGitDiff,
  getGitStatus,
  listDirectory,
  prepareFileMutation,
  prepareGitMutation,
  readTextFile,
  searchText,
  type FileMutationOperation,
  type GitMutationOperation,
} from "@/agent/tools";
import type { WorkspaceInfo } from "@/agent/workspace";

export type AgentLoopToolName =
  | "workspace.inspect"
  | "project.index"
  | "file.locate"
  | "file.list"
  | "file.read"
  | "file.search"
  | "git.status"
  | "git.diff"
  | "browser.open"
  | "file.replace.prepare"
  | "file.mutation.prepare"
  | "git.mutation.prepare";

export type AgentLoopToolSpec = {
  name: AgentLoopToolName;
  description: string;
  args: Record<string, string>;
};

export type AgentLoopToolContext = {
  workspace: WorkspaceInfo;
  taskId: string;
  projectIndex?: ProjectIndex;
};

export type AgentLoopToolResult = {
  result: unknown;
  context?: AgentLoopToolContext;
};

export type AgentLoopTool = AgentLoopToolSpec & {
  execute(
    args: Record<string, unknown>,
    context: AgentLoopToolContext,
  ): Promise<AgentLoopToolResult>;
};

function stringArg(
  args: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function numberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function compactIndex(index: ProjectIndex) {
  return {
    workspaceRoot: index.workspaceRoot,
    generatedAt: index.generatedAt,
    fileCount: index.files.length,
    routeCount: index.routes.length,
    apiRouteCount: index.apiRoutes.length,
    componentCount: index.components.length,
    routes: index.routes.slice(0, 30).map((file) => ({
      filePath: file.filePath,
      route: file.route,
      summary: file.summary,
    })),
    apiRoutes: index.apiRoutes.slice(0, 30).map((file) => ({
      filePath: file.filePath,
      route: file.route,
      methods: file.apiMethods,
      summary: file.summary,
    })),
    components: index.components.slice(0, 40).map((file) => ({
      filePath: file.filePath,
      exports: file.exports,
      summary: file.summary,
    })),
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function parseMutationOperation(args: Record<string, unknown>): FileMutationOperation {
  const type = args.type;
  if (type === "create") {
    return {
      type,
      path: stringArg(args, "path"),
      content: stringArg(args, "content"),
      overwrite: args.overwrite === true,
    };
  }
  if (type === "write") {
    return {
      type,
      path: stringArg(args, "path"),
      content: stringArg(args, "content"),
    };
  }
  if (type === "delete") {
    return {
      type,
      path: stringArg(args, "path"),
    };
  }
  if (type === "rename") {
    return {
      type,
      fromPath: stringArg(args, "fromPath"),
      toPath: stringArg(args, "toPath"),
      overwrite: args.overwrite === true,
    };
  }
  throw new Error("Unsupported file mutation type.");
}

async function prepareExactTextReplacement(
  args: Record<string, unknown>,
  context: AgentLoopToolContext,
) {
  const filePath = stringArg(args, "path");
  const search = stringArg(args, "search");
  const replace = stringArg(args, "replace");
  const replaceAll = args.all === true;

  if (!filePath) throw new Error("path is required.");
  if (!search) throw new Error("search is required.");

  const current = await readTextFile(context.workspace.rootPath, filePath, 500_000);
  const firstIndex = current.content.indexOf(search);
  if (firstIndex === -1) {
    throw new Error(`Search text was not found in ${filePath}.`);
  }

  const nextContent = replaceAll
    ? current.content.split(search).join(replace)
    : `${current.content.slice(0, firstIndex)}${replace}${current.content.slice(
        firstIndex + search.length,
      )}`;

  if (nextContent === current.content) {
    throw new Error("Replacement would not change the file.");
  }

  return prepareFileMutation({
    rootPath: context.workspace.rootPath,
    taskId: context.taskId,
    operation: {
      type: "write",
      path: current.path,
      content: nextContent,
    },
    createApproval: true,
  });
}

function parseGitMutationOperation(
  args: Record<string, unknown>,
): GitMutationOperation {
  const type = args.type;
  if (type === "branch") {
    return {
      type,
      branchName: stringArg(args, "branchName"),
      checkout: args.checkout !== false,
    };
  }
  if (type === "commit") {
    return {
      type,
      message: stringArg(args, "message"),
      all: args.all === true,
      paths: Array.isArray(args.paths)
        ? args.paths.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  }
  if (type === "push") {
    return {
      type,
      remote: stringArg(args, "remote", "origin"),
      branch: stringArg(args, "branch") || undefined,
      setUpstream: args.setUpstream === true,
    };
  }
  throw new Error("Unsupported git mutation type.");
}

export const AGENT_LOOP_TOOLS: AgentLoopTool[] = [
  {
    name: "workspace.inspect",
    description: "Read current workspace metadata, git status summary, and rule file names.",
    args: {},
    async execute(_args, context) {
      const workspace = context.workspace;
      return {
        result: {
          rootPath: workspace.rootPath,
          gitRootPath: workspace.gitRootPath,
          packageManager: workspace.packageManager,
          framework: workspace.framework,
          packageName: workspace.packageName,
          gitStatus: workspace.gitStatus,
          rules: workspace.rules.map((rule) => ({
            path: rule.path,
            truncated: rule.truncated,
          })),
        },
      };
    },
  },
  {
    name: "project.index",
    description: "Build a lightweight project index with pages, API routes, components, and summaries.",
    args: {},
    async execute(_args, context) {
      const projectIndex = await buildProjectIndex(context.workspace.rootPath);
      return {
        context: { ...context, projectIndex },
        result: compactIndex(projectIndex),
      };
    },
  },
  {
    name: "file.locate",
    description: "Find files related to a natural-language request using the project index.",
    args: {
      query: "Natural-language request or module/page name.",
      limit: "Optional max candidates, 1-20.",
    },
    async execute(args, context) {
      const projectIndex =
        context.projectIndex ?? (await buildProjectIndex(context.workspace.rootPath));
      const query = stringArg(args, "query");
      const limit = numberArg(args, "limit", 8, 1, 20);
      const located = locateFilesForRequest(projectIndex, query, limit);
      return {
        context: { ...context, projectIndex },
        result: {
          query: located.query,
          candidates: located.candidates.map((candidate) => ({
            filePath: candidate.file.filePath,
            kind: candidate.file.kind,
            route: candidate.file.route,
            score: candidate.score,
            reasons: candidate.reasons,
            summary: candidate.file.summary,
          })),
        },
      };
    },
  },
  {
    name: "file.list",
    description: "List files and directories under a workspace-relative path.",
    args: {
      path: "Workspace-relative directory path. Defaults to '.'.",
    },
    async execute(args, context) {
      const relativePath = stringArg(args, "path", ".");
      return {
        result: await listDirectory(context.workspace.rootPath, relativePath),
      };
    },
  },
  {
    name: "file.read",
    description: "Read a UTF-8 text file inside the workspace.",
    args: {
      path: "Workspace-relative file path.",
      maxBytes: "Optional max bytes, capped at 80000.",
    },
    async execute(args, context) {
      const relativePath = stringArg(args, "path");
      const maxBytes = numberArg(args, "maxBytes", 40_000, 1_000, 80_000);
      const result = await readTextFile(
        context.workspace.rootPath,
        relativePath,
        maxBytes,
      );
      return {
        result: {
          ...result,
          content: truncateText(result.content, 50_000),
        },
      };
    },
  },
  {
    name: "file.search",
    description: "Search text files in the workspace for an exact substring.",
    args: {
      query: "Search substring.",
      maxResults: "Optional max matches, 1-80.",
    },
    async execute(args, context) {
      const query = stringArg(args, "query");
      const maxResults = numberArg(args, "maxResults", 30, 1, 80);
      return {
        result: await searchText(context.workspace.rootPath, query, maxResults),
      };
    },
  },
  {
    name: "git.status",
    description: "Read git status --short --branch for the workspace.",
    args: {},
    async execute(_args, context) {
      return { result: await getGitStatus(context.workspace.rootPath) };
    },
  },
  {
    name: "git.diff",
    description: "Read current unstaged git diff for the workspace.",
    args: {},
    async execute(_args, context) {
      const result = await getGitDiff(context.workspace.rootPath);
      return {
        result: {
          ...result,
          stdout: truncateText(result.stdout, 60_000),
          stderr: truncateText(result.stderr, 10_000),
        },
      };
    },
  },
  {
    name: "browser.open",
    description: "Open an http/https URL in the product browser panel.",
    args: {
      url: "URL to open. Supports http, https, localhost, 127.0.0.1.",
    },
    async execute(args) {
      const url = stringArg(args, "url");
      return {
        result: await openBrowserUrl({ url, requestedBy: "agent" }),
      };
    },
  },
  {
    name: "file.mutation.prepare",
    description:
      "Prepare a create/write/delete/rename file change and create an approval request. Does not apply changes.",
    args: {
      type: "create | write | delete | rename",
      path: "Path for create/write/delete.",
      content: "New content for create/write.",
      fromPath: "Source path for rename.",
      toPath: "Destination path for rename.",
      overwrite: "Optional boolean for create/rename overwrite.",
    },
    async execute(args, context) {
      const operation = parseMutationOperation(args);
      return {
        result: await prepareFileMutation({
          rootPath: context.workspace.rootPath,
          taskId: context.taskId,
          operation,
          createApproval: true,
        }),
      };
    },
  },
  {
    name: "file.replace.prepare",
    description:
      "Prepare an exact text replacement in one file and create an approval request. Best for small edits like removing or renaming visible text. Does not apply changes.",
    args: {
      path: "Workspace-relative file path.",
      search: "Exact text to find.",
      replace: "Replacement text. Use empty string to remove text.",
      all: "Optional boolean. Replace all occurrences when true; otherwise replace the first occurrence.",
    },
    async execute(args, context) {
      return {
        result: await prepareExactTextReplacement(args, context),
      };
    },
  },
  {
    name: "git.mutation.prepare",
    description:
      "Prepare a Git branch/commit/push operation and create an approval request. Does not execute Git writes.",
    args: {
      type: "branch | commit | push",
      branchName: "Branch name for branch operations.",
      checkout: "Optional boolean. For branch, create and checkout by default.",
      message: "Commit message for commit operations.",
      all: "Optional boolean. For commit, use git commit -am.",
      paths: "Optional string array of paths for commit.",
      remote: "Remote for push. Defaults to origin.",
      branch: "Branch for push.",
      setUpstream: "Optional boolean for git push -u.",
    },
    async execute(args, context) {
      const operation = parseGitMutationOperation(args);
      return {
        result: prepareGitMutation({
          taskId: context.taskId,
          operation,
          createApproval: true,
        }),
      };
    },
  },
];

export function getAgentLoopTool(name: string): AgentLoopTool | undefined {
  return AGENT_LOOP_TOOLS.find((tool) => tool.name === name);
}

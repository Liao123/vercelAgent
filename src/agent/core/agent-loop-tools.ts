/**
 * Agent Loop 工具注册表。
 *
 * Agent Loop 可调用只读/低风险工具，也可以为文件变更和 Git 写操作准备审批。
 * prepare 类工具只创建 approval，不直接 apply。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  getPersistedBrowserPageSnapshot,
  getPersistedBrowserTarget,
  openBrowserUrl,
} from "@/agent/browser";
import {
  buildProjectIndex,
  locateFilesForRequest,
  traceUiEntryForQuery,
  traceUiEntryFromPage,
  layoutCandidateBoost,
  disambiguateUiLabels,
  disambiguationForRunState,
  findJsxText,
  findSymbolReferences,
  type ProjectIndex,
} from "@/agent/indexer";
import {
  applyUnifiedPatch,
  createPatchApproval,
  getGitDiff,
  getGitStatus,
  listDirectory,
  prepareFileMutation,
  prepareGitMutation,
  prepareShellCommand,
  readTextFile,
  searchText,
  type FileMutationOperation,
  type GitMutationOperation,
} from "@/agent/tools";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  assertPrepareGate,
  extractExistingPatchPaths,
  normalizeWorkspacePath,
} from "@/agent/core/prepare-gate";
import { buildPrepareEvidenceFromSearch } from "@/agent/approval/prepare-evidence";
import type { AgentUiContext } from "@/agent/types";
import type { WorkspaceInfo } from "@/agent/workspace";

export type AgentLoopToolName =
  | "workspace.inspect"
  | "project.index"
  | "file.locate"
  | "ui.trace_from_page"
  | "file.list"
  | "file.read"
  | "file.search"
  | "jsx.find_text"
  | "symbol.find_references"
  | "git.status"
  | "git.diff"
  | "browser.open"
  | "browser.inspect"
  | "file.replace.prepare"
  | "file.mutation.prepare"
  | "git.mutation.prepare"
  | "shell.command.prepare"
  | "patch.prepare";

export type AgentLoopToolSpec = {
  name: AgentLoopToolName;
  description: string;
  args: Record<string, string>;
};

export type AgentLoopToolContext = {
  workspace: WorkspaceInfo;
  taskId: string;
  projectIndex?: ProjectIndex;
  uiContext?: AgentUiContext;
  runState?: AgentLoopRunState;
};

function requireRunState(context: AgentLoopToolContext): AgentLoopRunState {
  if (!context.runState) {
    throw new Error("Internal error: prepare gate requires runState.");
  }
  return context.runState;
}

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

  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: [normalizeWorkspacePath(filePath)],
    runState: requireRunState(context),
    uiContext: context.uiContext,
  });

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

  const evidence = buildPrepareEvidenceFromSearch({
    path: current.path,
    content: current.content,
    search,
    source: "file.replace.prepare",
  });

  return prepareFileMutation({
    rootPath: context.workspace.rootPath,
    taskId: context.taskId,
    operation: {
      type: "write",
      path: current.path,
      content: nextContent,
    },
    createApproval: true,
    evidence,
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
    description:
      "Read current workspace metadata, structured git status (dirty + files[]), and rule file names.",
    args: {},
    async execute(_args, context) {
      const workspace = context.workspace;
      let lastPostExecuteVerification: unknown;
      try {
        const raw = await fs.readFile(
          path.join(workspace.rootPath, ".agent-state/post-execute-verify.json"),
          "utf8",
        );
        lastPostExecuteVerification = JSON.parse(raw) as unknown;
      } catch {
        lastPostExecuteVerification = undefined;
      }
      return {
        result: {
          rootPath: workspace.rootPath,
          gitRootPath: workspace.gitRootPath,
          packageManager: workspace.packageManager,
          framework: workspace.framework,
          packageName: workspace.packageName,
          git: workspace.git,
          lastPostExecuteVerification,
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
      const located = locateFilesForRequest(
        projectIndex,
        query,
        limit,
        context.uiContext,
      );
      const uiTrace = await traceUiEntryForQuery(
        context.workspace.rootPath,
        query,
        context.uiContext,
      );

      const candidateMap = new Map(
        located.candidates.map((candidate) => [
          candidate.file.filePath,
          { ...candidate },
        ]),
      );

      if (uiTrace) {
        for (const filePath of uiTrace.suggestedReadOrder) {
          const indexed = projectIndex.files.find((f) => f.filePath === filePath);
          if (!indexed) continue;
          const existing = candidateMap.get(filePath);
          const traceBonus = 40 - uiTrace.suggestedReadOrder.indexOf(filePath) * 3;
          const layoutBonus = context.uiContext
            ? layoutCandidateBoost(filePath, context.uiContext)
            : 0;
          const totalBonus = traceBonus + Math.max(0, layoutBonus);
          if (existing) {
            existing.score += totalBonus;
            existing.reasons.push({
              label: "ui entry import tree",
              score: totalBonus,
            });
          } else {
            candidateMap.set(filePath, {
              file: indexed,
              score: totalBonus + 20,
              reasons: [
                { label: "ui entry import tree", score: totalBonus + 20 },
              ],
            });
          }
        }
      }

      const mergedCandidates = [...candidateMap.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const disambiguationResult = await disambiguateUiLabels({
        rootPath: context.workspace.rootPath,
        query,
        uiContext: context.uiContext,
        traceSuggestedOrder: uiTrace?.suggestedReadOrder,
      });

      return {
        context: { ...context, projectIndex },
        result: {
          query: located.query,
          uiTrace: uiTrace
            ? {
                entryPath: uiTrace.entryPath,
                route: uiTrace.route,
                summary: uiTrace.summary,
                suggestedReadOrder: uiTrace.suggestedReadOrder,
                nodes: uiTrace.nodes.map((node) => ({
                  filePath: node.filePath,
                  depth: node.depth,
                  importedFrom: node.importedFrom,
                  visibleLabels: node.visibleLabels,
                })),
              }
            : undefined,
          disambiguation: disambiguationResult.hasAmbiguity
            ? {
                hasAmbiguity: true,
                primaryLabel: disambiguationResult.primaryLabel,
                mustReadPaths: disambiguationResult.mustReadPaths,
                recommendedPath: disambiguationResult.recommendedPath,
                selectionRationale: disambiguationResult.selectionRationale,
                summary: disambiguationResult.summary,
                groups: (disambiguationResult.groups ?? []).map((group) => ({
                  label: group.label,
                  recommendedPath: group.recommendedPath,
                  mustReadPaths: group.mustReadPaths,
                  candidates: group.candidates.map((candidate) => ({
                    filePath: candidate.filePath,
                    score: candidate.score,
                    reasons: candidate.reasons,
                    matches: candidate.matches,
                  })),
                })),
                ...disambiguationForRunState(disambiguationResult),
              }
            : {
                hasAmbiguity: false,
                summary: disambiguationResult.summary,
              },
          candidates: mergedCandidates.map((candidate) => ({
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
    name: "ui.trace_from_page",
    description:
      "Trace UI component import tree from a route page (default src/app/page.tsx). Use BEFORE editing homepage/buttons/visible labels—returns suggestedReadOrder for file.read.",
    args: {
      path: "Workspace-relative page file. Default src/app/page.tsx.",
      maxDepth: "Optional import depth 1-6. Default 5.",
    },
    async execute(args, context) {
      const entryPath = stringArg(args, "path", "src/app/page.tsx");
      const maxDepth = numberArg(args, "maxDepth", 5, 1, 6);
      const trace = await traceUiEntryFromPage(
        context.workspace.rootPath,
        entryPath,
        maxDepth,
        context.uiContext,
      );
      const userQuery = context.runState?.userRequest ?? "";
      const disambiguationResult = userQuery
        ? await disambiguateUiLabels({
            rootPath: context.workspace.rootPath,
            query: userQuery,
            uiContext: context.uiContext,
            traceSuggestedOrder: trace.suggestedReadOrder,
          })
        : {
            hasAmbiguity: false,
            groups: [],
            mustReadPaths: [],
            summary: "无 userRequest，跳过 label 消歧。",
          };

      return {
        result: {
          entryPath: trace.entryPath,
          route: trace.route,
          summary: trace.summary,
          suggestedReadOrder: trace.suggestedReadOrder,
          nodes: trace.nodes.map((node) => ({
            filePath: node.filePath,
            depth: node.depth,
            importedFrom: node.importedFrom,
            visibleLabels: node.visibleLabels,
          })),
          disambiguation: disambiguationResult.hasAmbiguity
            ? {
                hasAmbiguity: true,
                primaryLabel: disambiguationResult.primaryLabel,
                mustReadPaths: disambiguationResult.mustReadPaths ?? [],
                recommendedPath: disambiguationResult.recommendedPath,
                selectionRationale: disambiguationResult.selectionRationale,
                summary: disambiguationResult.summary,
                groups: disambiguationResult.groups ?? [],
                ...disambiguationForRunState(disambiguationResult),
              }
            : {
                hasAmbiguity: false,
                summary: disambiguationResult.summary,
              },
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
    name: "jsx.find_text",
    description:
      "Find visible UI text in TSX/JSX files with line numbers, component name guess, and UI path ranking. Prefer over file.search for labels like 闭环/Loop/buttons.",
    args: {
      query: "Visible label or short UI text to find in JSX.",
      maxResults: "Optional max matches, 1-40.",
    },
    async execute(args, context) {
      const query = stringArg(args, "query");
      const maxResults = numberArg(args, "maxResults", 24, 1, 40);
      return {
        result: await findJsxText({
          rootPath: context.workspace.rootPath,
          query,
          maxResults,
          uiContext: context.uiContext,
        }),
      };
    },
  },
  {
    name: "symbol.find_references",
    description:
      "Find import references to a workspace file path and/or export/import sites for a symbol name. Lightweight, no AST.",
    args: {
      path: "Optional workspace-relative file path (who imports this file).",
      name: "Optional exported symbol name (definitions + import lines).",
      maxResults: "Optional max results, 1-40.",
    },
    async execute(args, context) {
      const filePath = stringArg(args, "path");
      const name = stringArg(args, "name");
      const maxResults = numberArg(args, "maxResults", 30, 1, 40);
      if (!filePath && !name) {
        throw new Error("Provide at least one of path or name.");
      }
      const projectIndex =
        context.projectIndex ?? (await buildProjectIndex(context.workspace.rootPath));
      return {
        context: { ...context, projectIndex },
        result: await findSymbolReferences({
          rootPath: context.workspace.rootPath,
          index: projectIndex,
          path: filePath || undefined,
          name: name || undefined,
          maxResults,
        }),
      };
    },
  },
  {
    name: "git.status",
    description:
      "Read structured git status: { dirty, branch, ahead, behind, files[] with path+status, summary }.",
    args: {},
    async execute(_args, context) {
      try {
        const status = await getGitStatus(context.workspace.rootPath);
        return {
          result: {
            dirty: status.dirty,
            branch: status.branch,
            upstream: status.upstream,
            ahead: status.ahead,
            behind: status.behind,
            detached: status.detached,
            files: status.files,
            summary: status.summary,
          },
        };
      } catch {
        return {
          result: {
            dirty: false,
            branch: null,
            upstream: null,
            ahead: null,
            behind: null,
            detached: false,
            files: [],
            summary: "Not a git repository.",
          },
        };
      }
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
    name: "browser.inspect",
    description:
      "Read the latest in-app browser preview snapshot (title, text excerpt, url, console messages, DOM outline). Call browser.open first, then inspect after the page loads.",
    args: {},
    async execute() {
      const [target, snapshot] = await Promise.all([
        getPersistedBrowserTarget(),
        getPersistedBrowserPageSnapshot(),
      ]);
      return {
        result: {
          target,
          snapshot,
          hint: snapshot
            ? "Snapshot from embedded webview/iframe preview."
            : "No snapshot yet. Use browser.open and wait for preview to load.",
        },
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
      const requiredReadPaths: string[] = [];
      const exemptReadPaths: string[] = [];

      if (operation.type === "create") {
        exemptReadPaths.push(normalizeWorkspacePath(operation.path));
      } else if (operation.type === "write" || operation.type === "delete") {
        requiredReadPaths.push(normalizeWorkspacePath(operation.path));
      } else if (operation.type === "rename") {
        requiredReadPaths.push(normalizeWorkspacePath(operation.fromPath));
        exemptReadPaths.push(normalizeWorkspacePath(operation.toPath));
      }

      assertPrepareGate({
        toolName: "file.mutation.prepare",
        requiredReadPaths,
        exemptReadPaths,
        runState: requireRunState(context),
        uiContext: context.uiContext,
      });

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
        result: await prepareGitMutation({
          cwd: context.workspace.rootPath,
          taskId: context.taskId,
          operation,
          createApproval: true,
        }),
      };
    },
  },
  {
    name: "shell.command.prepare",
    description:
      "Prepare a whitelisted npm script (lint, build, test, typecheck) and create an approval. Does not run the command.",
    args: {
      script: "One of: lint, build, test, typecheck. Must exist in package.json.",
    },
    async execute(args, context) {
      const script = stringArg(args, "script") as
        | "lint"
        | "build"
        | "test"
        | "typecheck";
      if (!["lint", "build", "test", "typecheck"].includes(script)) {
        throw new Error("script must be lint, build, test, or typecheck.");
      }
      return {
        result: await prepareShellCommand({
          rootPath: context.workspace.rootPath,
          taskId: context.taskId,
          script,
          createApproval: true,
        }),
      };
    },
  },
  {
    name: "patch.prepare",
    description:
      "Submit a unified diff (modify/create/delete/rename) and create an approval. Use for multi-file or /dev/null patches. Does not apply until user approves.",
    args: {
      patch: "Full unified diff text with ---/+++ headers and @@ hunks.",
    },
    async execute(args, context) {
      const patch = stringArg(args, "patch");
      const existingPaths = extractExistingPatchPaths(patch);

      assertPrepareGate({
        toolName: "patch.prepare",
        requiredReadPaths: existingPaths,
        runState: requireRunState(context),
        uiContext: context.uiContext,
      });

      const patchResult = await applyUnifiedPatch({
        rootPath: context.workspace.rootPath,
        patch,
        mode: "preview",
      });
      const approval = createPatchApproval({
        taskId: context.taskId,
        patch,
        result: patchResult,
      });
      const changedCount = patchResult.files.filter((file) => file.changed).length;
      return {
        result: {
          ...patchResult,
          approval,
          summary: `Patch 预览 · ${changedCount} / ${patchResult.files.length} 个文件有变化`,
        },
      };
    },
  },
];

export function getAgentLoopTool(name: string): AgentLoopTool | undefined {
  return AGENT_LOOP_TOOLS.find((tool) => tool.name === name);
}

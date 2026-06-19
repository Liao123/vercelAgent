/**
 * Agent Loop 工具注册表。
 *
 * Agent Loop 可调用只读/低风险工具，也可以为文件变更和 Git 写操作准备审批。
 * prepare 类工具只创建 approval，不直接 apply。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  getBrowserQueryResult,
  getPersistedBrowserHarLog,
  getPersistedBrowserPageSnapshot,
  getPersistedBrowserTarget,
  openBrowserUrl,
  queueBrowserQuery,
  waitForBrowserQueryResult,
} from "@/agent/browser";
import {
  loadLatestDesignSpec,
  loadLatestDesignSpecMeta,
  saveDesignSpec,
} from "@/agent/browser/design-spec-store";
import {
  getBrowserTabsState,
  listBrowserPages,
  openBrowserUrlInTabs,
  switchBrowserTab,
} from "@/agent/browser/browser-tabs";
import {
  cdpActivateGuest,
  cdpAxTree,
  cdpBoxModelForSelector,
  cdpClick,
  cdpComputedStylesForSelector,
  cdpConsoleAndExceptions,
  cdpDomSnapshot,
  cdpInspectAt,
  cdpListGuestPages,
  cdpNetworkRequests,
  cdpPerformanceStartTrace,
  cdpPerformanceStopTrace,
  cdpScreenshotJpegBase64,
  cdpType,
} from "@/agent/devtools/cdp-client";
import { isCdpBridgeAvailable } from "@/agent/devtools/cdp-bridge-config";
import { extractDesignSpecFromPage, summarizeDesignSpec } from "@/agent/devtools/extract-design-spec";
import {
  analyzePerformanceInsight,
  enrichPerformanceStopResult,
} from "@/agent/devtools/performance-stop-result";
import { readBrowserNetworkForAgent } from "@/agent/devtools/network-read";
import { isCdpGuestReady } from "@/agent/devtools/cdp-guest-wait";
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
  applyUnifiedPatchDirect,
  createPatchApproval,
  executeFileMutationDirect,
  getGitDiff,
  getGitStatus,
  listDirectory,
  prepareFileMutation,
  prepareGitMutation,
  prepareShellCommand,
  prepareShellRun,
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
  | "browser.wait_and_inspect"
  | "browser.query"
  | "devtools.get_screenshot"
  | "devtools.get_dom_snapshot"
  | "devtools.get_accessibility_tree"
  | "devtools.get_console_errors"
  | "devtools.get_network_requests"
  | "devtools.click"
  | "devtools.type"
  | "devtools.get_box_model"
  | "devtools.get_computed_style"
  | "devtools.inspect_element_at"
  | "devtools.list_pages"
  | "devtools.new_page"
  | "devtools.switch_page"
  | "devtools.performance_start_trace"
  | "devtools.performance_stop_trace"
  | "devtools.performance_analyze_insight"
  | "devtools.extract_design_spec"
  | "devtools.get_persisted_design_spec"
  | "file.mutation.prepare"
  | "file.replace.prepare"
  | "git.mutation.prepare"
  | "shell.command.prepare"
  | "shell.run.prepare"
  | "patch.prepare"
  | "file.replace"
  | "file.mutation"
  | "patch.apply";

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

function booleanArg(
  args: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = args[key];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function buildExactTextWriteOperation(
  rootPath: string,
  filePath: string,
  search: string,
  replace: string,
  replaceAll: boolean,
) {
  const current = await readTextFile(rootPath, filePath, 500_000);
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

  return { current, nextContent, search };
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

  const { current, nextContent, search: resolvedSearch } =
    await buildExactTextWriteOperation(
      context.workspace.rootPath,
      filePath,
      search,
      replace,
      replaceAll,
    );

  const evidence = buildPrepareEvidenceFromSearch({
    path: current.path,
    content: current.content,
    search: resolvedSearch,
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

async function applyExactTextReplacement(
  args: Record<string, unknown>,
  context: AgentLoopToolContext,
) {
  const filePath = stringArg(args, "path");
  const search = stringArg(args, "search");
  const replace = stringArg(args, "replace");
  const replaceAll = args.all === true;

  if (!filePath) throw new Error("path is required.");
  if (!search) throw new Error("search is required.");

  const { current, nextContent } = await buildExactTextWriteOperation(
    context.workspace.rootPath,
    filePath,
    search,
    replace,
    replaceAll,
  );

  const applied = await executeFileMutationDirect({
    rootPath: context.workspace.rootPath,
    taskId: context.taskId,
    operation: {
      type: "write",
      path: current.path,
      content: nextContent,
    },
  });

  return {
    applied: true,
    mutation: applied,
    summary: `已写入 ${current.path}`,
  };
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
      newTab:
        "Optional boolean. When true, open in a new browser tab instead of the active tab.",
    },
    async execute(args) {
      const url = stringArg(args, "url");
      const newTab = args.newTab === true || args.newTab === "true";
      return {
        result: await openBrowserUrl({ url, requestedBy: "agent", newTab }),
      };
    },
  },
  {
    name: "browser.inspect",
    description:
      "Read browser snapshot: title, body text, DOM outline, console, HAR-lite network, screenshot. Best first step after browser.open for doc/API pages (often enough without devtools.get_network_requests).",
    args: {},
    async execute() {
      const [target, snapshot, queryResult, harLog] = await Promise.all([
        getPersistedBrowserTarget(),
        getPersistedBrowserPageSnapshot(),
        getBrowserQueryResult(),
        getPersistedBrowserHarLog(),
      ]);
      return {
        result: {
          target,
          snapshot,
          queryResult,
          harLog,
          hint: snapshot
            ? "Snapshot from embedded webview/iframe preview. Full HAR at GET /api/agent/browser/har."
            : "No snapshot yet. Use browser.open and wait for preview to load.",
        },
      };
    },
  },
  {
    name: "browser.wait_and_inspect",
    description:
      "For Apifox/API doc URLs: open (if url given) and poll until WebView snapshot has body text, then return inspect payload. Prefer over open+inspect+network chain.",
    args: {
      url: "Optional URL to open first",
      waitMs: "Max wait for snapshot ms (default 12000)",
    },
    async execute(args) {
      const urlArg = stringArg(args, "url");
      if (urlArg) {
        await openBrowserUrl({
          url: urlArg,
          requestedBy: "agent",
        });
      }

      const waitMsRaw = args.waitMs;
      const waitMs =
        typeof waitMsRaw === "number"
          ? waitMsRaw
          : typeof waitMsRaw === "string"
            ? Number.parseInt(waitMsRaw, 10)
            : 12_000;
      const waitCap = Math.min(Math.max(waitMs, 2000), 30_000);
      const started = Date.now();
      const deadline = started + waitCap;

      let snapshot = await getPersistedBrowserPageSnapshot();
      while (!snapshot?.textPreview?.trim() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        snapshot = await getPersistedBrowserPageSnapshot();
      }

      const [target, queryResult, harLog] = await Promise.all([
        getPersistedBrowserTarget(),
        getBrowserQueryResult(),
        getPersistedBrowserHarLog(),
      ]);

      let accessibilityTree: unknown = null;
      if (
        snapshot?.textPreview &&
        (await isCdpBridgeAvailable()) &&
        (await isCdpGuestReady())
      ) {
        try {
          accessibilityTree = await cdpAxTree();
        } catch {
          /* optional Codex/Cursor parity */
        }
      }

      return {
        result: {
          target,
          snapshot,
          accessibilityTree,
          queryResult,
          harLog,
          waitedMs: Date.now() - started,
          hint: snapshot?.textPreview
            ? "Cursor 同级路径：根据 snapshot + accessibilityTree 直接写中文 final，勿再调 Network。"
            : "Snapshot still empty — ensure dev:desktop and browser tab loaded the page, then retry or use browser.inspect.",
        },
      };
    },
  },
  {
    name: "browser.query",
    description:
      "Query DOM elements in the in-app browser preview by CSS selector. Requires browser.open first and desktop WebView (or wait for page load). Returns matching elements with text and bounding rect.",
    args: {
      selector: "CSS selector, e.g. button.primary or [data-testid=submit]",
      maxResults: "Optional max matches (default 12, max 40).",
    },
    async execute(args) {
      const selector = stringArg(args, "selector");
      const maxResultsRaw = args.maxResults;
      const maxResults =
        typeof maxResultsRaw === "number"
          ? maxResultsRaw
          : typeof maxResultsRaw === "string"
            ? Number.parseInt(maxResultsRaw, 10)
            : undefined;

      const pending = await queueBrowserQuery({ selector, maxResults });
      const result = await waitForBrowserQueryResult({
        selector: pending.selector,
        queuedAt: pending.queuedAt,
      });

      if (!result) {
        return {
          result: {
            status: "pending",
            selector: pending.selector,
            hint: "Query queued. Desktop WebView must be open on the browser tab. Retry browser.query or call browser.inspect.",
          },
        };
      }

      return {
        result: {
          status: "ok",
          selector: result.selector,
          url: result.url,
          matchCount: result.matches.length,
          matches: result.matches,
        },
      };
    },
  },
  {
    name: "devtools.get_screenshot",
    description:
      "Capture JPEG screenshot of the in-app browser via CDP Page.captureScreenshot. Requires desktop app and browser tab with loaded page.",
    args: {},
    async execute() {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: {
            ok: false,
            hint: "CDP bridge offline. Run npm run dev:desktop and open URL in browser tab.",
          },
        };
      }
      const jpegBase64 = await cdpScreenshotJpegBase64();
      return {
        result: {
          ok: Boolean(jpegBase64),
          format: "jpeg",
          byteLength: jpegBase64 ? Math.floor((jpegBase64.length * 3) / 4) : 0,
          jpegBase64Preview: jpegBase64
            ? `${jpegBase64.slice(0, 48)}…`
            : null,
          hint: jpegBase64
            ? "Full-page CDP capture (scroll area, max ~6000px height). Off-screen text also in browser.inspect textPreview/domOutline."
            : "Screenshot empty.",
        },
      };
    },
  },
  {
    name: "devtools.get_dom_snapshot",
    description:
      "CDP DOMSnapshot.captureSnapshot (layout + computed styles). Codex take_snapshot equivalent.",
    args: {},
    async execute() {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: {
            ok: false,
            hint: "CDP bridge offline. Use npm run dev:desktop.",
          },
        };
      }
      const snapshot = await cdpDomSnapshot();
      return { result: { ok: true, snapshot } };
    },
  },
  {
    name: "devtools.get_accessibility_tree",
    description:
      "CDP Accessibility.getFullAXTree for the in-app browser page.",
    args: {},
    async execute() {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const tree = await cdpAxTree();
      return { result: { ok: true, tree } };
    },
  },
  {
    name: "devtools.get_console_errors",
    description:
      "Read console messages and runtime exceptions from CDP (Log + Runtime).",
    args: {},
    async execute() {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const { console, exceptions } = await cdpConsoleAndExceptions();
      return {
        result: {
          ok: true,
          console,
          exceptions,
          errorCount: exceptions.length,
        },
      };
    },
  },
  {
    name: "devtools.get_network_requests",
    description:
      "List network requests (CDP Network). Falls back to HAR-lite from browser.inspect. Prefer browser.inspect for Apifox/doc pages.",
    args: {},
    async execute() {
      const result = await readBrowserNetworkForAgent();
      return { result };
    },
  },
  {
    name: "devtools.click",
    description:
      "Click an element in the in-app browser by CSS selector (CDP Input.dispatchMouseEvent).",
    args: {
      selector: "CSS selector for target element",
    },
    async execute(args) {
      const selector = stringArg(args, "selector");
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const out = await cdpClick(selector);
      return { result: out };
    },
  },
  {
    name: "devtools.type",
    description:
      "Type text into a focused input/textarea via CSS selector (focus + CDP Input.insertText).",
    args: {
      selector: "CSS selector",
      text: "Text to insert",
    },
    async execute(args) {
      const selector = stringArg(args, "selector");
      const text = stringArg(args, "text");
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const out = await cdpType(selector, text);
      return { result: out };
    },
  },
  {
    name: "devtools.get_box_model",
    description: "CDP DOM.getBoxModel for element matching CSS selector.",
    args: {
      selector: "CSS selector",
    },
    async execute(args) {
      const selector = stringArg(args, "selector");
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const boxModel = await cdpBoxModelForSelector(selector);
      return { result: { ok: true, selector, boxModel } };
    },
  },
  {
    name: "devtools.get_computed_style",
    description:
      "CDP CSS.getComputedStyleForNode for element matching CSS selector.",
    args: {
      selector: "CSS selector",
    },
    async execute(args) {
      const selector = stringArg(args, "selector");
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const styles = await cdpComputedStylesForSelector(selector, []);
      return { result: { ok: true, selector, styles } };
    },
  },
  {
    name: "devtools.inspect_element_at",
    description:
      "CDP DOM.getNodeForLocation at viewport coordinates (x, y).",
    args: {
      x: "X coordinate in viewport pixels",
      y: "Y coordinate in viewport pixels",
    },
    async execute(args) {
      const x = numberArg(args, "x", 0, 0, 10_000);
      const y = numberArg(args, "y", 0, 0, 10_000);
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const node = await cdpInspectAt(x, y);
      return { result: { ok: true, x, y, node } };
    },
  },
  {
    name: "devtools.list_pages",
    description:
      "List open browser tabs (tabId, guestId, url, title, active index). Codex list_pages parity.",
    args: {},
    async execute() {
      const pages = await listBrowserPages();
      let cdpGuests: unknown = null;
      if (await isCdpBridgeAvailable()) {
        try {
          cdpGuests = await cdpListGuestPages();
        } catch {
          /* optional */
        }
      }
      return { result: { pages, cdpGuests } };
    },
  },
  {
    name: "devtools.new_page",
    description:
      "Open a URL in a new browser tab. Codex new_page parity.",
    args: {
      url: "http(s) URL for the new tab.",
    },
    async execute(args) {
      const url = stringArg(args, "url");
      const { tab, state } = await openBrowserUrlInTabs({
        url,
        requestedBy: "agent",
        newTab: true,
      });
      return { result: { tab, version: state.version } };
    },
  },
  {
    name: "devtools.switch_page",
    description:
      "Switch active browser tab by tabId, guestId, or zero-based index from list_pages.",
    args: {
      tabId: "Tab id from list_pages.",
      guestId: "WebView guest id from list_pages.",
      index: "Zero-based tab index from list_pages.",
    },
    async execute(args) {
      const state = await getBrowserTabsState();
      let tabId = stringArg(args, "tabId");
      if (!tabId) {
        const guestId = numberArg(args, "guestId", -1, 0, 999_999);
        const index = numberArg(args, "index", -1, 0, 99);
        if (guestId >= 0) {
          const match = state.tabs.find(
            (tab) => tab.guestWebContentsId === guestId,
          );
          if (match) tabId = match.id;
        } else if (index >= 0 && index < state.tabs.length) {
          tabId = state.tabs[index]!.id;
        }
      }
      if (!tabId) {
        throw new Error("tabId, guestId, or index is required.");
      }
      const next = await switchBrowserTab(tabId);
      const tab = next.tabs.find((item) => item.id === tabId);
      if (
        tab?.guestWebContentsId != null &&
        (await isCdpBridgeAvailable())
      ) {
        try {
          await cdpActivateGuest(tab.guestWebContentsId);
        } catch {
          /* guest may not be mounted yet */
        }
      }
      return {
        result: {
          activeTabId: next.activeTabId,
          tab,
          version: next.version,
        },
      };
    },
  },
  {
    name: "devtools.performance_start_trace",
    description:
      "Start a CDP performance trace on the in-app browser page (aligns with chrome-devtools-mcp performance_start_trace). Use before measuring load or interaction. Pair with performance_stop_trace.",
    args: {
      reload:
        "Optional boolean: reload page after trace starts to profile full load.",
      autoStop:
        "Optional boolean: auto-stop trace after ~5s and return combined summary.",
    },
    async execute(args) {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const reload = booleanArg(args, "reload", false);
      const autoStop = booleanArg(args, "autoStop", false);
      const start = await cdpPerformanceStartTrace({ reload });
      if (!autoStop) {
        return { result: start };
      }
      await sleepMs(5000);
      const stop = await cdpPerformanceStopTrace();
      const result = await enrichPerformanceStopResult(stop);
      return {
        result: {
          ...result,
          autoStop: true,
        },
      };
    },
  },
  {
    name: "devtools.performance_stop_trace",
    description:
      "Stop CDP performance trace and return metrics, page timing (FCP/LCP/load), availableInsights list, and optional trace file path.",
    args: {},
    async execute() {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const stop = await cdpPerformanceStopTrace();
      const result = await enrichPerformanceStopResult(stop);
      return { result };
    },
  },
  {
    name: "devtools.performance_analyze_insight",
    description:
      "Deep-dive a Performance Insight from the last trace recording (aligns with chrome-devtools-mcp performance_analyze_insight). Use insightName from availableInsights after stop_trace.",
    args: {
      insightName:
        "Insight name, e.g. DocumentLatency, LCPBreakdown, LongTasks, LayoutShifts, NetworkSummary, MainThreadTopTasks.",
      insightSetId:
        "Optional id from stop_trace (trace file basename). Defaults to last recording.",
      traceFile:
        "Optional absolute path to trace JSON; defaults to last stop_trace file.",
    },
    async execute(args) {
      const insightName = stringArg(args, "insightName");
      if (!insightName) {
        throw new Error("insightName is required.");
      }
      const insightSetId = stringArg(args, "insightSetId");
      const traceFile = stringArg(args, "traceFile");
      const result = await analyzePerformanceInsight({
        insightName,
        insightSetId: insightSetId || undefined,
        traceFile: traceFile || undefined,
      });
      return { result };
    },
  },
  {
    name: "devtools.extract_design_spec",
    description:
      "Extract structured design spec from the current browser page and persist to .agent-state/design-specs. Use for demo-to-code / page replicate workflows (A024). Returns summary + persist path.",
    args: {},
    async execute() {
      if (!(await isCdpBridgeAvailable())) {
        return {
          result: { ok: false, hint: "CDP bridge offline." },
        };
      }
      const spec = await extractDesignSpecFromPage();
      const meta = await saveDesignSpec(spec);
      const summary = summarizeDesignSpec(spec);
      return {
        result: {
          ok: true,
          summary,
          nodeCount: spec.nodes.length,
          persisted: meta,
          hint: "完整 spec 已落盘；写码用 summary，勿凭截图猜样式。",
        },
      };
    },
  },
  {
    name: "devtools.get_persisted_design_spec",
    description:
      "Read the latest persisted design spec summary from .agent-state (after extract_design_spec).",
    args: {},
    async execute() {
      const spec = await loadLatestDesignSpec();
      if (!spec) {
        return {
          result: {
            ok: false,
            hint: "无 persisted design spec。请先 browser.open demo URL 并 devtools.extract_design_spec。",
          },
        };
      }
      const meta = await loadLatestDesignSpecMeta();
      return {
        result: {
          ok: true,
          meta,
          summary: summarizeDesignSpec(spec),
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
      "Prepare an npm script from package.json and create an approval. Does not run until user approves. Prefer script names like validate:agent, verify:smoke, lint, build.",
    args: {
      script: "Exact npm script name from package.json (e.g. lint, validate:agent, verify:smoke).",
    },
    async execute(args, context) {
      const script = stringArg(args, "script").trim();
      if (!script) {
        throw new Error("script is required.");
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
    name: "shell.run.prepare",
    description:
      "Prepare an arbitrary workspace shell command and create an approval (Cursor-style terminal). Examples: npm run validate:agent, npx --yes tsx scripts/foo.ts, node scripts/trial.mjs. Blocked patterns are rejected. Does not run until user approves.",
    args: {
      command:
        "Full shell command to run in workspace root (e.g. npm run verify:smoke).",
    },
    async execute(args, context) {
      const command = stringArg(args, "command");
      return {
        result: await prepareShellRun({
          rootPath: context.workspace.rootPath,
          taskId: context.taskId,
          command,
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
  {
    name: "file.replace",
    description:
      "Apply an exact text replacement and write to disk immediately (Cursor-like). Prefer over file.replace.prepare for normal edits.",
    args: {
      path: "Workspace-relative file path.",
      search: "Exact text to find on disk.",
      replace: "Replacement text. Use empty string to remove text.",
      all: "Optional boolean. Replace all occurrences when true.",
    },
    async execute(args, context) {
      return {
        result: await applyExactTextReplacement(args, context),
      };
    },
  },
  {
    name: "file.mutation",
    description:
      "Create or overwrite a file on disk immediately. Use write for existing files, create for new paths.",
    args: {
      type: "create | write",
      path: "Workspace-relative path.",
      content: "Full file content.",
      overwrite: "Optional boolean for create when file exists.",
    },
    async execute(args, context) {
      const type = args.type;
      if (type !== "create" && type !== "write") {
        throw new Error("Direct file.mutation only supports create or write.");
      }
      const operation = parseMutationOperation(args);
      const applied = await executeFileMutationDirect({
        rootPath: context.workspace.rootPath,
        taskId: context.taskId,
        operation,
      });
      return {
        result: {
          applied: true,
          mutation: applied,
          summary: `已${operation.type === "create" ? "创建" : "写入"} ${applied.preview.path}`,
        },
      };
    },
  },
  {
    name: "patch.apply",
    description:
      "Apply a unified diff to disk immediately. Use for multi-file changes. Prefer over patch.prepare.",
    args: {
      patch: "Full unified diff with ---/+++ and @@ hunks.",
    },
    async execute(args, context) {
      const patch = stringArg(args, "patch");
      const patchResult = await applyUnifiedPatchDirect({
        rootPath: context.workspace.rootPath,
        patch,
      });
      const changedCount = patchResult.files.filter((file) => file.changed).length;
      return {
        result: {
          ...patchResult,
          summary: `已应用 patch · ${changedCount} / ${patchResult.files.length} 个文件有变化`,
        },
      };
    },
  },
];

export function getAgentLoopTool(name: string): AgentLoopTool | undefined {
  return AGENT_LOOP_TOOLS.find((tool) => tool.name === name);
}

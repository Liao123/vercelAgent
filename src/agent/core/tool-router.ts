import {
  AGENT_LOOP_TOOLS,
  type AgentLoopTool,
  type AgentLoopToolName,
} from "@/agent/core/agent-loop-tools";

export type ToolExposure = "direct" | "deferred" | "hidden";

export type ToolSearchResult = {
  name: AgentLoopToolName;
  description: string;
  args: Record<string, string>;
  exposure: ToolExposure;
  score: number;
};

type ToolRouterOptions = {
  discoveredToolNames?: string[];
  includeDeferred?: boolean;
  strictPrepare?: boolean;
};

const DIRECT_TOOL_NAMES = new Set<AgentLoopToolName>([
  "tool.search",
  "agent.diagnose",
  "agent.bootstrap.check",
  "workspace.inspect",
  "project.index",
  "file.locate",
  "ui.trace_from_page",
  "file.list",
  "file.read",
  "file.search",
  "git.status",
  "git.diff",
  "browser.open",
  "browser.inspect",
  "file.replace",
  "file.mutation",
  "patch.apply",
  "shell.run.prepare",
]);

const HIDDEN_TOOL_NAMES = new Set<AgentLoopToolName>();

const PREPARE_TOOL_NAMES = new Set<AgentLoopToolName>([
  "file.mutation.prepare",
  "file.replace.prepare",
  "git.mutation.prepare",
  "shell.command.prepare",
  "shell.run.prepare",
  "patch.prepare",
]);

const SEARCH_SYNONYMS: Partial<Record<AgentLoopToolName, string[]>> = {
  "browser.wait_and_inspect": ["wait", "page load", "snapshot", "browser"],
  "browser.query": ["ask page", "browser question", "extract page"],
  "devtools.get_screenshot": ["screenshot", "image", "visual"],
  "devtools.get_dom_snapshot": ["dom", "html", "structure"],
  "devtools.get_accessibility_tree": ["accessibility", "a11y", "labels"],
  "devtools.get_console_errors": ["console", "error", "exception"],
  "devtools.get_network_requests": ["network", "request", "api", "har"],
  "devtools.click": ["click", "interact", "button"],
  "devtools.type": ["type", "input", "form"],
  "devtools.get_box_model": ["box", "layout", "size", "position"],
  "devtools.get_computed_style": ["css", "style", "color", "font"],
  "devtools.inspect_element_at": ["element", "coordinate", "inspect"],
  "devtools.list_pages": ["tabs", "pages", "browser"],
  "devtools.new_page": ["new tab", "page", "browser"],
  "devtools.switch_page": ["switch tab", "page", "browser"],
  "devtools.performance_start_trace": ["performance", "trace", "lcp"],
  "devtools.performance_stop_trace": ["performance", "trace", "metrics"],
  "devtools.performance_analyze_insight": ["performance", "insight", "trace"],
  "devtools.extract_design_spec": ["design", "replicate", "figma", "spec"],
  "devtools.get_persisted_design_spec": ["design spec", "persisted spec"],
  "jsx.find_text": ["jsx", "text", "label", "component"],
  "symbol.find_references": ["references", "symbol", "usage"],
  "file.mutation.prepare": ["approval", "prepare", "file change"],
  "file.replace.prepare": ["approval", "prepare", "replace"],
  "git.mutation.prepare": ["approval", "git", "commit", "branch", "push"],
  "shell.command.prepare": ["approval", "npm script", "command"],
  "patch.prepare": ["approval", "patch", "diff"],
};

const CJK_QUERY_EXPANSIONS: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /\u622a\u56fe|\u753b\u9762|\u89c6\u89c9/u,
    terms: ["screenshot", "visual"],
  },
  {
    pattern: /\u6837\u5f0f|\u989c\u8272|\u5b57\u4f53|css/iu,
    terms: ["css", "style", "color", "font"],
  },
  {
    pattern: /\u70b9\u51fb|\u6309\u94ae|\u4ea4\u4e92/u,
    terms: ["click", "button", "interact"],
  },
  { pattern: /\u8f93\u5165|\u8868\u5355/u, terms: ["type", "input", "form"] },
  {
    pattern: /\u63a7\u5236\u53f0|\u62a5\u9519|\u5f02\u5e38/u,
    terms: ["console", "error", "exception"],
  },
  {
    pattern: /\u7f51\u7edc|\u8bf7\u6c42|\u63a5\u53e3/u,
    terms: ["network", "request", "api"],
  },
  {
    pattern: /\u8bbe\u8ba1|\u590d\u523b|\u89c4\u683c/u,
    terms: ["design", "replicate", "spec"],
  },
  {
    pattern: /\u6587\u6848|\u7ec4\u4ef6|\u53ef\u89c1\u6587\u5b57/u,
    terms: ["jsx", "text", "component"],
  },
  {
    pattern: /\u5f15\u7528|\u7b26\u53f7|\u4f7f\u7528\u4f4d\u7f6e/u,
    terms: ["references", "symbol", "usage"],
  },
  {
    pattern: /\u5ba1\u6279|\u9884\u89c8|\u51c6\u5907/u,
    terms: ["approval", "prepare"],
  },
];

export function getToolExposure(name: AgentLoopToolName): ToolExposure {
  if (HIDDEN_TOOL_NAMES.has(name)) return "hidden";
  if (DIRECT_TOOL_NAMES.has(name)) return "direct";
  return "deferred";
}

export function isToolVisibleByDefault(name: AgentLoopToolName): boolean {
  return getToolExposure(name) === "direct";
}

export function getAllLoopTools(): AgentLoopTool[] {
  return AGENT_LOOP_TOOLS;
}

export function getModelVisibleLoopTools(
  options: ToolRouterOptions = {},
): AgentLoopTool[] {
  const discovered = new Set(options.discoveredToolNames ?? []);
  const tools = getAllLoopTools().filter((tool) => {
    if (tool.name === "tool.search") return true;
    const exposure = getToolExposure(tool.name);
    if (exposure === "hidden") return false;
    if (exposure === "direct") return true;
    if (options.strictPrepare === true && PREPARE_TOOL_NAMES.has(tool.name)) {
      return true;
    }
    return options.includeDeferred === true || discovered.has(tool.name);
  });
  return tools;
}

function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase();
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9_.-]+/gi)) {
    if (match[0]) terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const phrase = match[0];
    if (!phrase) continue;
    terms.add(phrase);
    for (let index = 0; index < phrase.length - 1; index += 1) {
      terms.add(phrase.slice(index, index + 2));
    }
  }
  for (const expansion of CJK_QUERY_EXPANSIONS) {
    if (!expansion.pattern.test(query)) continue;
    for (const term of expansion.terms) terms.add(term);
  }
  return [...terms];
}

export function searchDeferredTools(
  query: string,
  limit = 6,
): ToolSearchResult[] {
  const terms = queryTerms(query);
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 20)
    : 6;
  const candidates = AGENT_LOOP_TOOLS.filter(
    (tool) => getToolExposure(tool.name) === "deferred",
  );

  return candidates
    .map((tool) => {
      const haystack = [
        tool.name,
        tool.description,
        ...Object.keys(tool.args),
        ...Object.values(tool.args),
        ...(SEARCH_SYNONYMS[tool.name] ?? []),
      ]
        .join(" ")
        .toLowerCase();
      const score =
        terms.length === 0
          ? 1
          : terms.reduce((total, term) => {
              if (tool.name.toLowerCase().includes(term)) return total + 8;
              if (haystack.includes(term)) return total + 3;
              return total;
            }, 0);
      return {
        name: tool.name,
        description: tool.description,
        args: tool.args,
        exposure: "deferred" as const,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, safeLimit);
}

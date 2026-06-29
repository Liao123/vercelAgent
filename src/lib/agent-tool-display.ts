import { formatPatchToolResultSummary } from "@/lib/patch-summary";
import { extractToolUnlocks } from "@/lib/agent-tool-unlocks";
import { formatModelErrorMessage } from "@/lib/model-error-message";

const TOOL_LABELS: Record<string, string> = {
  "tool.search": "搜索工具",
  "workspace.inspect": "检查工作区",
  "project.index": "索引项目",
  "file.locate": "定位文件",
  "ui.trace_from_page": "追踪页面组件树",
  "file.list": "列出目录",
  "file.read": "读取文件",
  "file.search": "搜索文件",
  "jsx.find_text": "查找文案",
  "symbol.find_references": "查找引用",
  "git.status": "检查 Git 状态",
  "git.diff": "读取 Git diff",
  "browser.open": "打开浏览器",
  "browser.inspect": "读取浏览器快照",
  "browser.wait_and_inspect": "等待并读取页面",
  "browser.query": "查询页面元素",
  "devtools.extract_design_spec": "提取设计规格",
  "devtools.get_persisted_design_spec": "读取设计规格",
  "devtools.get_screenshot": "截图",
  "devtools.get_dom_snapshot": "读取 DOM 快照",
  "devtools.get_accessibility_tree": "读取无障碍树",
  "devtools.get_console_errors": "读取 Console",
  "devtools.get_network_requests": "读取 Network",
  "devtools.click": "点击页面",
  "devtools.type": "输入页面",
  "devtools.get_box_model": "读取盒模型",
  "devtools.get_computed_style": "读取计算样式",
  "devtools.inspect_element_at": "探测坐标元素",
  "file.replace": "修改文件",
  "file.mutation": "写入文件",
  "file.mutation.prepare": "准备文件变更",
  "file.replace.prepare": "准备文本替换",
  "patch.apply": "应用 Patch",
  "patch.prepare": "准备 Patch",
  "git.mutation.prepare": "准备 Git 操作",
  "shell.command.prepare": "准备命令",
  "shell.run.prepare": "准备终端命令",
  "agent.diagnose": "诊断环境",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  value: unknown,
  fields: string[],
): string | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const field of fields) {
    const candidate = record[field];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function pathFromOperation(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const operation = asRecord(record.operation);
  return stringField(operation, ["path", "toPath", "fromPath"]);
}

function pathFromCandidates(value: unknown): string | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.candidates)) return null;
  for (const item of record.candidates) {
    const path = stringField(item, ["path", "filePath"]);
    if (path) return path;
  }
  return null;
}

export function agentToolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  if (toolName.startsWith("mcp.chrome-devtools.")) {
    return `Chrome ${toolName.split(".").at(-1) ?? "工具"}`;
  }
  if (toolName.startsWith("mcp.")) {
    return toolName.split(".").slice(-2).join(".");
  }
  if (toolName.startsWith("file.")) return "处理文件";
  if (toolName.startsWith("browser.")) return "操作浏览器";
  if (toolName.startsWith("devtools.")) return "检查页面";
  if (toolName.startsWith("shell.")) return "处理命令";
  return toolName;
}

export function summarizeAgentToolTarget(
  toolName: string,
  args: unknown,
  result: unknown,
): string | null {
  if (toolName === "tool.search") {
    const unlocks = extractToolUnlocks(result);
    if (unlocks.length > 0) return `解锁 ${unlocks.length} 个工具`;
  }

  const patchHint = formatPatchToolResultSummary(result);
  if (patchHint) return patchHint;

  const path =
    stringField(args, ["path", "filePath", "fromPath", "toPath"]) ??
    pathFromOperation(args) ??
    stringField(result, ["path", "filePath", "fromPath", "toPath"]) ??
    pathFromOperation(result) ??
    pathFromCandidates(result);
  if (path) return path.replaceAll("\\", "/");

  const command =
    stringField(args, ["command", "script", "cmd"]) ??
    stringField(result, ["command", "script", "cmd"]);
  if (command) return command;

  const url = stringField(args, ["url", "href"]) ?? stringField(result, ["url", "href"]);
  if (url) return url;

  const query =
    stringField(args, ["query", "pattern", "text", "selector"]) ??
    stringField(result, ["query", "pattern", "text", "selector"]);
  if (query) return `"${query}"`;

  const resultRecord = asRecord(result);
  if (resultRecord?.approval && typeof resultRecord.approval === "object") {
    const title = stringField(resultRecord.approval, ["title"]);
    return title ? `已创建审批：${title}` : "已创建审批请求";
  }
  if (typeof resultRecord?.summary === "string" && resultRecord.summary.trim()) {
    return resultRecord.summary.trim();
  }
  if (Array.isArray(resultRecord?.candidates)) {
    return `${resultRecord.candidates.length} 个候选`;
  }
  if (Array.isArray(resultRecord?.files)) {
    return `${resultRecord.files.length} 个文件`;
  }

  return null;
}

export function formatAgentToolAction(input: {
  toolName: string;
  args?: unknown;
  result?: unknown;
  running?: boolean;
  error?: string;
}): { action: string; target: string | null; label: string } {
  const label = agentToolLabel(input.toolName);
  const target = summarizeAgentToolTarget(
    input.toolName,
    input.args,
    input.result,
  );
  if (input.error) {
    return { action: label, target, label };
  }
  return {
    action: `${input.running ? "正在" : "已"}${label}`,
    target,
    label,
  };
}

export function agentToolIssueLabel(input: {
  recovered?: boolean;
  taskStillRunning?: boolean;
}): string {
  if (input.recovered) return "遇到问题，已继续";
  if (input.taskStillRunning === false) return "遇到问题";
  return "遇到问题，正在换策略";
}

export function formatAgentToolIssueDetail(error: unknown): string {
  return formatModelErrorMessage(error);
}

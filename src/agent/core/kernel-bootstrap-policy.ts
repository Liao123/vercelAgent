/**
 * 阶段 C：受控自举 — 改 src/agent 内核时的路径门禁 + validate 建议。
 */
export type KernelWriteEvaluation = {
  path: string;
  allowed: boolean;
  tier: "user" | "kernel" | "blocked";
  reason?: string;
};

export type KernelBootstrapPlan = {
  ok: boolean;
  paths: KernelWriteEvaluation[];
  validateScripts: string[];
  requiresDevRestart: boolean;
  restartHint: string;
  summary: string;
};

const BLOCKED_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.env(\.|$)/i, reason: "禁止修改 .env / 密钥文件" },
  { pattern: /(^|\/)node_modules(\/|$)/i, reason: "禁止修改 node_modules" },
  { pattern: /(^|\/)\.git(\/|$)/i, reason: "禁止修改 .git" },
  { pattern: /credentials/i, reason: "禁止修改 credentials 类文件" },
  { pattern: /(^|\/)dist-desktop(\/|$)/i, reason: "禁止修改打包产物 dist-desktop" },
];

const KERNEL_PREFIXES = ["src/agent/", "src/agent-server/"] as const;

const VALIDATE_RULES: Array<{ prefix: string; scripts: string[] }> = [
  { prefix: "src/agent-server/", scripts: ["validate:agent-server"] },
  { prefix: "src/agent/mcp/", scripts: ["validate:mcp-integration"] },
  { prefix: "src/agent/terminal/", scripts: ["validate:pty-terminal"] },
  { prefix: "src/agent/core/task-playbooks", scripts: ["validate:task-playbooks"] },
  {
    prefix: "src/agent/core/agent-loop",
    scripts: ["validate:loop-state", "validate:native-tool-loop"],
  },
  { prefix: "src/agent/core/", scripts: ["validate:generic-capability"] },
  { prefix: "src/agent/", scripts: ["validate:agent"] },
];

const RESTART_PREFIXES = [
  "src/agent/core/agent-loop",
  "src/agent/core/agent-loop-tools",
  "src/agent/mcp/",
  "src/agent-server/",
  "src/agent/prompts/",
  "src/agent/model/loop-tool-schemas",
] as const;

export function isKernelBootstrapEnabled(): boolean {
  return process.env.AGENT_KERNEL_BOOTSTRAP !== "0";
}

export function normalizeKernelRelativePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isKernelPath(normalized: string): boolean {
  return KERNEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function blockedReason(normalized: string): string | null {
  for (const rule of BLOCKED_PATH_PATTERNS) {
    if (rule.pattern.test(normalized)) return rule.reason;
  }
  return null;
}

export function evaluateKernelWritePath(filePath: string): KernelWriteEvaluation {
  const normalized = normalizeKernelRelativePath(filePath);
  const blocked = blockedReason(normalized);
  if (blocked) {
    return { path: normalized, allowed: false, tier: "blocked", reason: blocked };
  }
  if (!isKernelPath(normalized)) {
    return { path: normalized, allowed: true, tier: "user" };
  }
  if (!isKernelBootstrapEnabled()) {
    return {
      path: normalized,
      allowed: false,
      tier: "kernel",
      reason:
        "内核自举已关闭（AGENT_KERNEL_BOOTSTRAP=0）。仅允许改用户项目文件，或显式开启自举。",
    };
  }
  return { path: normalized, allowed: true, tier: "kernel" };
}

export function assertKernelWriteAllowed(filePath: string): void {
  const evaluation = evaluateKernelWritePath(filePath);
  if (!evaluation.allowed) {
    throw new Error(
      evaluation.reason ?? `Kernel write blocked: ${evaluation.path}`,
    );
  }
}

export function assertKernelWriteAllowedMany(paths: string[]): void {
  for (const filePath of paths) {
    assertKernelWriteAllowed(filePath);
  }
}

export function suggestValidateScriptsForPaths(paths: string[]): string[] {
  const scripts = new Set<string>();
  const normalized = paths.map(normalizeKernelRelativePath);
  for (const filePath of normalized) {
    if (!isKernelPath(filePath)) continue;
    const rule =
      VALIDATE_RULES.find((entry) => filePath.startsWith(entry.prefix)) ??
      null;
    if (rule) {
      for (const script of rule.scripts) scripts.add(script);
    }
  }
  if (scripts.size === 0 && normalized.some(isKernelPath)) {
    scripts.add("validate:agent");
  }
  return [...scripts].map((name) => `npm run ${name}`);
}

export function kernelPathsRequireDevRestart(paths: string[]): boolean {
  const normalized = paths.map(normalizeKernelRelativePath);
  return normalized.some((filePath) =>
    RESTART_PREFIXES.some((prefix) => filePath.startsWith(prefix)),
  );
}

export function buildKernelBootstrapPlan(paths: string[]): KernelBootstrapPlan {
  const unique = [...new Set(paths.map(normalizeKernelRelativePath))];
  const evaluations = unique.map(evaluateKernelWritePath);
  const blocked = evaluations.filter((item) => !item.allowed);
  const kernelPaths = evaluations
    .filter((item) => item.tier === "kernel" && item.allowed)
    .map((item) => item.path);
  const validateScripts = suggestValidateScriptsForPaths(kernelPaths);
  const requiresDevRestart = kernelPathsRequireDevRestart(kernelPaths);
  const ok = blocked.length === 0;

  const summaryParts: string[] = [];
  if (!ok) {
    summaryParts.push(
      `blocked: ${blocked.map((item) => `${item.path} (${item.reason})`).join("; ")}`,
    );
  } else if (kernelPaths.length > 0) {
    summaryParts.push(`kernel paths ok (${kernelPaths.length})`);
    if (validateScripts.length > 0) {
      summaryParts.push(`run: ${validateScripts.join(" && ")}`);
    }
    if (requiresDevRestart) {
      summaryParts.push("restart npm run dev or dev:desktop after loop/mcp changes");
    }
  } else {
    summaryParts.push("no kernel paths — normal user-project edit");
  }

  return {
    ok,
    paths: evaluations,
    validateScripts,
    requiresDevRestart,
    restartHint: requiresDevRestart
      ? "改动 Loop/MCP/agent-server 后需重启 npm run dev 或 npm run dev:desktop。"
      : "无需重启 dev。",
    summary: summaryParts.join(" · "),
  };
}

export function isKernelBootstrapPath(filePath: string): boolean {
  const normalized = normalizeKernelRelativePath(filePath);
  return KERNEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isKernelAutoValidateEnabled(): boolean {
  if (process.env.AGENT_KERNEL_AUTO_VALIDATE === "0") return false;
  return isKernelBootstrapEnabled();
}

export function buildCombinedValidateCommand(scripts: string[]): string | null {
  if (scripts.length === 0) return null;
  return scripts.join(" && ");
}

export function buildKernelBootstrapSideEffect(
  changedPaths: string[],
): {
  followUp: string | null;
  kernelPaths: string[];
  validateScripts: string[];
  validateCommand: string | null;
  requiresDevRestart: boolean;
} {
  const kernelPaths = [
    ...new Set(changedPaths.map(normalizeKernelRelativePath)),
  ].filter(isKernelBootstrapPath);
  if (kernelPaths.length === 0) {
    return {
      followUp: null,
      kernelPaths: [],
      validateScripts: [],
      validateCommand: null,
      requiresDevRestart: false,
    };
  }
  const plan = buildKernelBootstrapPlan(kernelPaths);
  return {
    followUp: buildKernelBootstrapFollowUp(kernelPaths),
    kernelPaths,
    validateScripts: plan.validateScripts,
    validateCommand: buildCombinedValidateCommand(plan.validateScripts),
    requiresDevRestart: plan.requiresDevRestart,
  };
}

export function buildKernelBootstrapFollowUp(paths: string[]): string | null {
  const plan = buildKernelBootstrapPlan(paths);
  const kernelPaths = plan.paths.filter(
    (item) => item.tier === "kernel" && item.allowed,
  );
  if (kernelPaths.length === 0) return null;

  const lines = [
    "【内核自举】已写入 Agent 内核文件。",
    plan.validateScripts.length > 0
      ? `请 shell.run.prepare 运行：${plan.validateScripts.join(" → ")}`
      : "请运行相关 npm run validate:* 脚本。",
    plan.restartHint,
  ];
  return lines.join("\n");
}

export function mutationOperationPaths(
  operation: {
    type: string;
    path?: string;
    fromPath?: string;
    toPath?: string;
  },
): string[] {
  const paths: string[] = [];
  if (operation.path) paths.push(operation.path);
  if (operation.fromPath) paths.push(operation.fromPath);
  if (operation.toPath) paths.push(operation.toPath);
  return paths;
}

export function resolvePathsFromPatch(patch: string): string[] {
  const paths = new Set<string>();
  for (const match of patch.matchAll(/^(?:---|\+\+\+) [ab]\/(.+)$/gm)) {
    const value = match[1]?.trim();
    if (value && value !== "/dev/null") {
      paths.add(normalizeKernelRelativePath(value));
    }
  }
  return [...paths];
}

/** 客户端/服务端共用的内核路径识别（不依赖 env）。 */
export function normalizeKernelRelativePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

const KERNEL_PREFIXES = ["src/agent/", "src/agent-server/"] as const;

export function isKernelBootstrapPath(filePath: string): boolean {
  const normalized = normalizeKernelRelativePath(filePath);
  return KERNEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export type KernelBootstrapReviewHint = {
  paths: string[];
  validateScripts: string[];
  validateCommand: string | null;
  requiresDevRestart: boolean;
  autoValidatePrepared?: boolean;
  restartRecommended?: boolean;
  restartMessage?: string | null;
  restartCommand?: string | null;
};

export function kernelBootstrapHintFromFiles(
  files: Array<{ path: string }>,
): KernelBootstrapReviewHint | null {
  const paths = files
    .map((file) => normalizeKernelRelativePath(file.path))
    .filter(isKernelBootstrapPath);
  if (paths.length === 0) return null;
  return {
    paths: [...new Set(paths)],
    validateScripts: [],
    validateCommand: null,
    requiresDevRestart: paths.some(
      (path) =>
        path.startsWith("src/agent/core/agent-loop") ||
        path.startsWith("src/agent/mcp/") ||
        path.startsWith("src/agent-server/") ||
        path.startsWith("src/agent/prompts/"),
    ),
  };
}

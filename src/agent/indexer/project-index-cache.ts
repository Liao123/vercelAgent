/**
 * 会话级 project index 缓存：同 workspace 在 TTL 内复用 build 结果。
 */
import { buildProjectIndex } from "@/agent/indexer/project-indexer";
import type { ProjectIndex } from "@/agent/indexer/types";

type CacheEntry = {
  index: ProjectIndex;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function cacheTtlMs(): number {
  const raw = process.env.AGENT_PROJECT_INDEX_CACHE_TTL_MS;
  if (raw === "0") return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

function normalizeRoot(rootPath: string): string {
  return rootPath.replaceAll("\\", "/");
}

export async function getOrBuildProjectIndex(
  rootPath: string,
): Promise<ProjectIndex> {
  const key = normalizeRoot(rootPath);
  const ttl = cacheTtlMs();
  const existing = cache.get(key);
  if (existing && (ttl === 0 || Date.now() - existing.builtAt < ttl)) {
    return existing.index;
  }

  const index = await buildProjectIndex(rootPath);
  if (ttl > 0) {
    cache.set(key, { index, builtAt: Date.now() });
  }
  return index;
}

export function invalidateProjectIndexCache(rootPath?: string): void {
  if (!rootPath) {
    cache.clear();
    return;
  }
  cache.delete(normalizeRoot(rootPath));
}

export function peekProjectIndexCache(rootPath: string): ProjectIndex | undefined {
  const entry = cache.get(normalizeRoot(rootPath));
  return entry?.index;
}

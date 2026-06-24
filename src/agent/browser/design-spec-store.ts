/**
 * A024：design spec 持久化（demo URL → 结构化 JSON → 代码生成）。
 * 路径锚定 workspace.rootPath，避免 cwd（dev 进程）与目标项目不一致。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DesignSpec } from "@/agent/devtools/extract-design-spec";

const REL_DIR = ".agent-state/design-specs";
const LATEST_META = "latest.json";

export type PersistedDesignSpecMeta = {
  id: string;
  /** workspace 相对路径 */
  filePath: string;
  url: string;
  title: string;
  nodeCount: number;
  extractedAt: string;
  savedAt: string;
};

function specsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, REL_DIR);
}

function metaPath(workspaceRoot: string): string {
  return path.join(specsDir(workspaceRoot), LATEST_META);
}

function toWorkspaceRelative(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).replaceAll("\\", "/");
}

function resolveStoredPath(workspaceRoot: string, stored: string): string {
  if (path.isAbsolute(stored)) return stored;
  return path.join(workspaceRoot, stored.replace(/^\.\/+/, ""));
}

export async function saveDesignSpec(
  spec: DesignSpec,
  workspaceRoot: string = process.cwd(),
): Promise<PersistedDesignSpecMeta> {
  const dir = specsDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const id = `spec-${Date.now()}`;
  const absFilePath = path.join(dir, `${id}.json`);
  await fs.writeFile(absFilePath, JSON.stringify(spec, null, 2), "utf8");

  const meta: PersistedDesignSpecMeta = {
    id,
    filePath: toWorkspaceRelative(workspaceRoot, absFilePath),
    url: spec.url,
    title: spec.title,
    nodeCount: spec.nodes.length,
    extractedAt: spec.extractedAt,
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(metaPath(workspaceRoot), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export async function loadLatestDesignSpecMeta(
  workspaceRoot: string = process.cwd(),
): Promise<PersistedDesignSpecMeta | null> {
  for (const root of [workspaceRoot, process.cwd()]) {
    try {
      const raw = await fs.readFile(metaPath(root), "utf8");
      return JSON.parse(raw) as PersistedDesignSpecMeta;
    } catch {
      /* try next root */
    }
  }
  return null;
}

export async function loadLatestDesignSpec(
  workspaceRoot: string = process.cwd(),
): Promise<DesignSpec | null> {
  const meta = await loadLatestDesignSpecMeta(workspaceRoot);
  if (!meta?.filePath) return null;
  for (const root of [workspaceRoot, process.cwd()]) {
    try {
      const raw = await fs.readFile(
        resolveStoredPath(root, meta.filePath),
        "utf8",
      );
      return JSON.parse(raw) as DesignSpec;
    } catch {
      /* try next root */
    }
  }
  return null;
}

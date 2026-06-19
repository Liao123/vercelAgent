/**
 * A024：design spec 持久化（demo URL → 结构化 JSON → 代码生成）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DesignSpec } from "@/agent/devtools/extract-design-spec";

const REL_DIR = ".agent-state/design-specs";
const LATEST_META = "latest.json";

export type PersistedDesignSpecMeta = {
  id: string;
  filePath: string;
  url: string;
  title: string;
  nodeCount: number;
  extractedAt: string;
  savedAt: string;
};

function specsDir(): string {
  return path.join(process.cwd(), REL_DIR);
}

function metaPath(): string {
  return path.join(specsDir(), LATEST_META);
}

export async function saveDesignSpec(spec: DesignSpec): Promise<PersistedDesignSpecMeta> {
  const dir = specsDir();
  await fs.mkdir(dir, { recursive: true });
  const id = `spec-${Date.now()}`;
  const filePath = path.join(dir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(spec, null, 2), "utf8");

  const meta: PersistedDesignSpecMeta = {
    id,
    filePath,
    url: spec.url,
    title: spec.title,
    nodeCount: spec.nodes.length,
    extractedAt: spec.extractedAt,
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(metaPath(), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export async function loadLatestDesignSpecMeta(): Promise<PersistedDesignSpecMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(), "utf8");
    return JSON.parse(raw) as PersistedDesignSpecMeta;
  } catch {
    return null;
  }
}

export async function loadLatestDesignSpec(): Promise<DesignSpec | null> {
  const meta = await loadLatestDesignSpecMeta();
  if (!meta?.filePath) return null;
  try {
    const raw = await fs.readFile(meta.filePath, "utf8");
    return JSON.parse(raw) as DesignSpec;
  } catch {
    return null;
  }
}

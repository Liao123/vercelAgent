import fs from "node:fs";
import path from "node:path";

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!key) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function readEnvFile(filePath: string, into: Map<string, string>): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    into.set(parsed[0], parsed[1]);
  }
  return true;
}

/**
 * 与 Next 类似：`.env` + `.env.local`（后者覆盖前者），但不覆盖已存在的 process.env（含 shell 注入）。
 */
export function loadProjectEnvFiles(rootDir: string = process.cwd()): string[] {
  const merged = new Map<string, string>();
  const loaded: string[] = [];
  for (const name of [".env", ".env.local"] as const) {
    const filePath = path.join(rootDir, name);
    if (readEnvFile(filePath, merged)) loaded.push(name);
  }
  for (const [key, value] of merged) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
  return loaded;
}

export function loadAgentServerEnv(rootDir?: string): string[] {
  return loadProjectEnvFiles(rootDir);
}

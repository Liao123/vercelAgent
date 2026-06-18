/**
 * 读取 Electron 主进程 CDP HTTP 桥地址（`.agent-state/cdp-bridge.json`）。
 */
import fs from "node:fs/promises";
import path from "node:path";

export type CdpBridgeConfig = {
  baseUrl: string;
  port?: number;
  updatedAt?: string;
};

function bridgePath(): string {
  return path.join(process.cwd(), ".agent-state", "cdp-bridge.json");
}

export async function getCdpBridgeBaseUrl(): Promise<string | null> {
  const fromEnv = process.env.VEC_CDP_BRIDGE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  try {
    const raw = await fs.readFile(bridgePath(), "utf8");
    const parsed = JSON.parse(raw) as CdpBridgeConfig;
    if (parsed.baseUrl?.trim()) {
      return parsed.baseUrl.trim().replace(/\/$/, "");
    }
  } catch {
    /* bridge not running */
  }
  return null;
}

export async function isCdpBridgeAvailable(): Promise<boolean> {
  const base = await getCdpBridgeBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

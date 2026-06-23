import { isCdpBridgeAvailable } from "@/agent/devtools/cdp-bridge-config";
import {
  getMcpRegistrySnapshot,
  isMcpIntegrationEnabled,
  resolveMcpConfigPath,
} from "@/agent/mcp";
import { resolveUserDesktopDir } from "@/lib/user-path";
import type { WorkspaceInfo } from "@/agent/workspace";

export type AgentDiagnosePayload = {
  ok: boolean;
  summary: string;
  workspace: {
    rootPath: string;
    framework: string | null;
    packageManager: string;
  };
  runtime: {
    desktopShellHint: string;
    userDesktopDir: string;
    savePathAliases: string[];
  };
  mcp: {
    enabled: boolean;
    configPath: string | null;
    servers: Array<{
      id: string;
      connected: boolean;
      toolCount: number;
      error?: string;
    }>;
    toolCount: number;
  };
  browser: {
    cdpBridgeOnline: boolean;
    suggestedBuiltinTools: string[];
  };
  suggestions: string[];
};

export async function collectAgentDiagnosePayload(
  workspace: WorkspaceInfo,
): Promise<AgentDiagnosePayload> {
  const mcpSnapshot = getMcpRegistrySnapshot();
  const cdpOnline = await isCdpBridgeAvailable();
  const desktopDir = resolveUserDesktopDir();
  const suggestions: string[] = [];

  const mcpEnabled = isMcpIntegrationEnabled();
  const mcpConnected = mcpSnapshot.servers.filter((s) => s.connected);
  const mcpFailed = mcpSnapshot.servers.filter((s) => !s.connected);

  if (mcpEnabled && mcpConnected.length === 0 && mcpFailed.length > 0) {
    suggestions.push(
      "MCP 已配置但未连接：检查 mcp.json / Chrome 是否可用，或改用内置 devtools.* / browser.*。",
    );
  } else if (!mcpEnabled) {
    suggestions.push(
      "MCP 未启用：可复制 mcp.config.example.json → mcp.json，或设置 AGENT_MCP_ENABLED=1。",
    );
  }

  if (!cdpOnline) {
    suggestions.push(
      "CDP 桥离线：运行 npm run dev:desktop，在右栏「浏览器」Tab 打开页面后再截图/检查。",
    );
  }

  if (cdpOnline || mcpConnected.some((s) => /chrome|devtools/i.test(s.id))) {
    suggestions.push(
      "截图保存到桌面：devtools.get_screenshot 或 mcp.chrome-devtools.take_screenshot，filePath 用 desktop:name.jpg 或 ~/Desktop/name.jpg。",
    );
  }

  const summaryParts: string[] = [];
  if (mcpConnected.length > 0) {
    summaryParts.push(`MCP ${mcpConnected.length} 服已连`);
  } else if (mcpEnabled) {
    summaryParts.push("MCP 未连");
  }
  summaryParts.push(cdpOnline ? "CDP 在线" : "CDP 离线");

  return {
    ok: cdpOnline || mcpConnected.length > 0,
    summary: summaryParts.join(" · "),
    workspace: {
      rootPath: workspace.rootPath,
      framework: workspace.framework,
      packageManager: workspace.packageManager,
    },
    runtime: {
      desktopShellHint: "桌面能力需 npm run dev:desktop",
      userDesktopDir: desktopDir,
      savePathAliases: ["~/Desktop/file.png", "desktop:file.png"],
    },
    mcp: {
      enabled: mcpEnabled,
      configPath: mcpSnapshot.configPath ?? resolveMcpConfigPath(),
      servers: mcpSnapshot.servers.map((s) => ({
        id: s.id,
        connected: s.connected,
        toolCount: s.toolCount,
        error: s.error,
      })),
      toolCount: mcpSnapshot.tools.length,
    },
    browser: {
      cdpBridgeOnline: cdpOnline,
      suggestedBuiltinTools: [
        "browser.wait_and_inspect",
        "browser.open",
        "browser.inspect",
        "devtools.get_screenshot",
        "devtools.list_pages",
      ],
    },
    suggestions,
  };
}

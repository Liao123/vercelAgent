import {
  ensureMcpRegistryReady,
  getMcpRegistrySnapshot,
  reloadMcpRegistry,
  resolveMcpConfigPath,
} from "@/agent/mcp";

export const dynamic = "force-dynamic";

/** MCP 服务器状态与已发现工具列表 */
export async function GET() {
  try {
    await ensureMcpRegistryReady();
    const snapshot = getMcpRegistrySnapshot();
    return Response.json({
      ...snapshot,
      configPath: snapshot.configPath ?? resolveMcpConfigPath(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read MCP status.",
      },
      { status: 500 },
    );
  }
}

/** 重新连接所有 MCP 服务器（配置变更后） */
export async function POST() {
  try {
    const snapshot = await reloadMcpRegistry();
    const { invalidateLoopToolDefinitionCache } = await import(
      "@/agent/model/loop-tool-schemas"
    );
    invalidateLoopToolDefinitionCache();
    return Response.json({ ok: true, ...snapshot });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to reload MCP servers.",
      },
      { status: 500 },
    );
  }
}

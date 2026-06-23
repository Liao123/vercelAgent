import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  const registry = await read("src/agent/mcp/registry.ts");
  const config = await read("src/agent/mcp/config.ts");
  const schemas = await read("src/agent/model/loop-tool-schemas.ts");
  const runner = await read("src/agent/core/agent-loop-tool-runner.ts");
  const loop = await read("src/agent/core/agent-loop.ts");
  const route = await read("src/app/api/agent/mcp/route.ts");
  const pkg = JSON.parse(await read("package.json")) as {
    dependencies?: Record<string, string>;
  };

  assert.ok(
    pkg.dependencies?.["@modelcontextprotocol/sdk"],
    "@modelcontextprotocol/sdk dependency",
  );
  assert.ok(
    config.includes("mcpServers") && config.includes("resolveMcpConfigPath"),
    "Cursor-compatible MCP config loader",
  );
  assert.ok(
    registry.includes("StdioClientTransport") &&
      registry.includes("StreamableHTTPClientTransport"),
    "stdio + HTTP MCP transports",
  );
  assert.ok(
    registry.includes("listTools") && registry.includes("callTool"),
    "MCP tool discovery and execution",
  );
  assert.ok(
    schemas.includes("getMcpToolDefinitions") &&
      schemas.includes("decodeMcpApiToolName"),
    "loop tool schema merges MCP tools",
  );
  assert.ok(
    runner.includes("runMcpLoopToolCall") &&
      runner.includes("isMcpInternalToolName"),
    "agent loop MCP tool routing",
  );
  assert.ok(
    loop.includes("ensureMcpRegistryReady") &&
      loop.includes("invalidateLoopToolDefinitionCache") &&
      loop.includes("getMcpRegistrySnapshot"),
    "loop initializes MCP registry",
  );
  assert.ok(
    (await read("src/agent/mcp/runtime.ts")).includes("useRemoteAgentServer"),
    "MCP runtime facade for agent-server",
  );
  assert.ok(route.includes("reloadMcpRegistry"), "MCP status API");
  const nativePrompt = await read("src/agent/prompts/loop-system-native.md");
  assert.ok(
    nativePrompt.includes("use them FIRST") &&
      nativePrompt.includes("MCP_TOOLS_BLOCK"),
    "loop prompt MCP browser priority",
  );
  assert.ok(
    !nativePrompt.includes("DESKTOP_HINT"),
    "no hardcoded desktop path placeholder in prompt",
  );
  assert.ok(
    (await read("src/agent/mcp/prompt-block.ts")).includes(
      "formatMcpToolsForPrompt",
    ),
    "MCP prompt block formatter",
  );
  assert.ok(
    (await read("src/agent/prompts/create-loop-system-prompt.ts")).includes(
      "mcpSnapshot",
    ),
    "system prompt injects MCP snapshot",
  );
  assert.ok(
    await fs
      .access(path.join(ROOT, "mcp.config.example.json"))
      .then(() => true)
      .catch(() => false),
    "mcp.config.example.json",
  );

  console.log("validate-mcp-integration: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

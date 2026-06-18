import { AGENT_LOOP_TOOLS } from "@/agent/core/agent-loop-tools";
import { describeUiContextForPrompt } from "@/agent/indexer/ui-layout-boost";
import {
  formatWorkspaceMemoryBlock,
  loadWorkspaceMemory,
} from "@/agent/memory/workspace-memory";
import type { AgentUiContext } from "@/agent/types";
import {
  loadPromptFile,
  normalizePromptWhitespace,
  renderPrompt,
} from "@/agent/prompts/load-prompt";
import { isNativeToolLoopEnabled } from "@/agent/core/loop-protocol";

let cachedJsonTemplate: string | null = null;
let cachedNativeTemplate: string | null = null;

function getLoopSystemTemplate(): string {
  if (isNativeToolLoopEnabled()) {
    if (!cachedNativeTemplate) {
      cachedNativeTemplate = loadPromptFile("loop-system-native.md");
    }
    return cachedNativeTemplate;
  }
  if (!cachedJsonTemplate) {
    cachedJsonTemplate = loadPromptFile("loop-system.md");
  }
  return cachedJsonTemplate;
}

export function createLoopSystemPrompt(
  workspaceRoot: string,
  uiContext?: AgentUiContext,
): string {
  const toolList = AGENT_LOOP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    args: tool.args,
  }));

  const memory = loadWorkspaceMemory(workspaceRoot);
  const memoryBlock = memory ? formatWorkspaceMemoryBlock(memory) : "";

  return normalizePromptWhitespace(
    renderPrompt(getLoopSystemTemplate(), {
      WORKSPACE_ROOT: workspaceRoot,
      UI_CONTEXT: describeUiContextForPrompt(uiContext) ?? "",
      TOOLS_JSON: isNativeToolLoopEnabled()
        ? ""
        : JSON.stringify(toolList),
      WORKSPACE_MEMORY_BLOCK: memoryBlock,
    }),
  );
}

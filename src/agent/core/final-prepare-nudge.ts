/**
 * A087：主循环用尽仍未 prepare 时，追加一轮「仅允许 file.replace.prepare」的模型调用。
 */
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  allDisambiguationCandidatesRead,
  buildUiPrepareNudgeBlock,
  isUiPrepareEvidenceReady,
} from "@/agent/core/ui-prepare-nudge";
import type { AgentUiContext } from "@/agent/types";

const PREPARE_TOOL_NAMES = new Set([
  "file.replace.prepare",
  "file.mutation.prepare",
  "patch.prepare",
]);

export function hasAttemptedPrepareTool(state: AgentLoopRunState): boolean {
  return state.toolsCalled.some((tool) => PREPARE_TOOL_NAMES.has(tool));
}

export function shouldRunFinalPrepareNudge(
  state: AgentLoopRunState,
  uiContext?: AgentUiContext,
): boolean {
  if (state.approvalPrepared || !state.likelyEditRequest) return false;
  if (hasAttemptedPrepareTool(state)) return false;
  if (!state.prepareHint || state.prepareHint.suggestedSearchLines.length === 0) {
    return false;
  }
  if (!allDisambiguationCandidatesRead(state)) return false;
  return isUiPrepareEvidenceReady(state, uiContext);
}

export function buildFinalPrepareNudgeUserMessage(
  state: AgentLoopRunState,
): string | null {
  const nudge = buildUiPrepareNudgeBlock(state);
  if (!nudge) return null;

  return [
    "=== Final prepare round (A087) ===",
    "Main loop ended without an approval. You have already read the target file.",
    "Your ONLY allowed next action: ONE tool_call to file.replace.prepare on the path below.",
    "Copy ONE Candidate JSON string verbatim into search (include spaces).",
    "Do not action=reflect, do not file.read again, do not action=final.",
    "",
    nudge,
  ].join("\n");
}

export function isPrepareToolName(toolName: string): boolean {
  return PREPARE_TOOL_NAMES.has(toolName);
}

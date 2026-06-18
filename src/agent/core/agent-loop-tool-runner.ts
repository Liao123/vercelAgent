/**
 * Agent Loop 单工具执行（JSON / 原生 tool_calls 共用，A114）。
 */
import {
  getAgentLoopTool,
  type AgentLoopToolContext,
} from "@/agent/core/agent-loop-tools";
import {
  buildRuntimeCheckpoint,
  isExplicitReadOnlyRequest,
  recordToolCall,
  type AgentLoopRunState,
} from "@/agent/core/agent-loop-state";
import {
  emitDirectApplySideEffects,
  isDirectMutationToolName,
  isEditTaskSatisfied,
} from "@/agent/core/loop-direct-apply";
import { captureUiPrepareHintFromFileRead } from "@/agent/core/ui-prepare-nudge";
import { buildToolObservationMessage } from "@/agent/memory/loop-context-compactor";
import type { AppliedFileMutation } from "@/agent/tools/file-mutations";
import type { PatchResult } from "@/agent/tools/patch-tools";
import type { AgentEvent, AgentMessage, AgentReflection, ToolCallRecord } from "@/agent/types";
import { nowIso, newId } from "@/agent/types";

export function createLoopToolCallRecord(
  taskId: string,
  toolName: string,
  args: unknown,
  rationale?: string,
): ToolCallRecord {
  return {
    id: newId("tool"),
    taskId,
    toolName,
    args,
    ...(rationale ? { rationale } : {}),
    startedAt: nowIso(),
  };
}

export function completeLoopToolCallRecord(
  call: ToolCallRecord,
  error?: string,
): ToolCallRecord {
  return {
    ...call,
    completedAt: nowIso(),
    error,
  };
}

export function extractApprovalFromToolResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  if (!("approval" in result)) return null;
  const approval = (result as { approval?: unknown }).approval;
  if (!approval || typeof approval !== "object") return null;
  if (!("id" in approval) || !("action" in approval)) return null;
  return approval as Extract<AgentEvent, { type: "approval.required" }>["approval"];
}

export type AgentLoopToolRunnerDeps = {
  taskId: string;
  rootPath: string;
  emit: (event: AgentEvent) => void;
  runState: AgentLoopRunState;
  getToolContext: () => AgentLoopToolContext;
  setToolContext: (ctx: AgentLoopToolContext) => void;
  emitReflection: (reflection: AgentReflection) => void;
  pushReflectionToMessages: (
    reflection: AgentReflection,
    checkpoint?: string,
  ) => void;
  shouldInjectRuntimeReflection: (state: AgentLoopRunState) => boolean;
  emitPlan: (hint?: { lastAction?: string }) => void;
  fallbackSummary: (error: unknown) => string;
};

export type AgentLoopToolRunResult = {
  observationText: string;
  observationMessage: AgentMessage;
  toolContext: AgentLoopToolContext;
};

export async function runAgentLoopToolCall(input: {
  toolName: string;
  args: Record<string, unknown>;
  rationale?: string;
  patchTextFallback?: string;
  toolCallId?: string;
  deps: AgentLoopToolRunnerDeps;
}): Promise<AgentLoopToolRunResult> {
  const { deps } = input;
  const tool = getAgentLoopTool(input.toolName);

  if (!tool) {
    const observation = {
      error: `Tool is not allowed: ${input.toolName}`,
    };
    recordToolCall(deps.runState, "tool.error", observation, observation.error);
    const observationMessage = buildToolObservationMessage("tool.error", observation, {
      workspaceRoot: deps.rootPath,
      toolName: "tool.error",
      toolCallId: input.toolCallId,
    });
    return {
      observationText:
        typeof observationMessage.content === "string"
          ? observationMessage.content
          : JSON.stringify(observationMessage.content),
      observationMessage,
      toolContext: deps.getToolContext(),
    };
  }

  const toolCall = createLoopToolCallRecord(
    deps.taskId,
    tool.name,
    input.args,
    input.rationale,
  );
  const observationCtx = {
    workspaceRoot: deps.rootPath,
    toolName: tool.name,
    toolCallId: input.toolCallId ?? toolCall.id,
  };
  deps.emit({ type: "tool.started", taskId: deps.taskId, toolCall });

  try {
    let toolContext = deps.getToolContext();
    const toolResult = await tool.execute(input.args, toolContext);
    if (toolResult.context) {
      toolContext = toolResult.context;
      deps.setToolContext(toolContext);
    }

    deps.emit({
      type: "tool.completed",
      taskId: deps.taskId,
      toolCall: completeLoopToolCallRecord(toolCall),
      result: toolResult.result,
    });
    recordToolCall(deps.runState, tool.name, toolResult.result);

    if (
      tool.name === "file.read" &&
      toolResult.result &&
      typeof toolResult.result === "object"
    ) {
      const readResult = toolResult.result as { path?: unknown; content?: unknown };
      if (
        typeof readResult.path === "string" &&
        typeof readResult.content === "string"
      ) {
        captureUiPrepareHintFromFileRead(
          deps.runState,
          readResult.path,
          readResult.content,
          toolContext.uiContext,
        );
      }
    }

    const approval = extractApprovalFromToolResult(toolResult.result);
    if (approval) {
      deps.runState.approvalPrepared = true;
      if (deps.runState.postExecuteFeedback) {
        delete deps.runState.postExecuteFeedback;
      }
      deps.emit({
        type: "approval.required",
        taskId: deps.taskId,
        approval,
      });
    }

    if (
      isDirectMutationToolName(tool.name) &&
      toolResult.result &&
      typeof toolResult.result === "object"
    ) {
      const directResult = toolResult.result as {
        applied?: boolean;
        mutation?: AppliedFileMutation;
        files?: PatchResult["files"];
      };
      if (directResult.mutation?.applied) {
        await emitDirectApplySideEffects({
          taskId: deps.taskId,
          toolName: tool.name,
          rootPath: deps.rootPath,
          emit: deps.emit,
          runState: deps.runState,
          fileResult: directResult.mutation,
        });
      } else if (tool.name === "patch.apply" && directResult.applied === true) {
        await emitDirectApplySideEffects({
          taskId: deps.taskId,
          toolName: tool.name,
          rootPath: deps.rootPath,
          emit: deps.emit,
          runState: deps.runState,
          patchResult: directResult as PatchResult,
          patchText: input.patchTextFallback,
        });
      }
    }

    const observationMessage = buildToolObservationMessage(
      tool.name,
      toolResult.result,
      observationCtx,
    );
    const observationText =
      typeof observationMessage.content === "string"
        ? observationMessage.content
        : JSON.stringify(observationMessage.content);

    if (deps.shouldInjectRuntimeReflection(deps.runState)) {
      deps.runState.reflectionRounds += 1;
      const pendingLintFix =
        Boolean(deps.runState.postExecuteFeedback) && !isEditTaskSatisfied(deps.runState);
      deps.emitReflection({
        understanding: isEditTaskSatisfied(deps.runState)
          ? "文件变更已应用或已就绪。"
          : pendingLintFix
            ? "写盘后 lint 未通过，请用 file.replace 修复。"
            : "工具已运行，任务尚未完成。",
        blockers: [
          ...(deps.runState.postExecuteFeedback
            ? [deps.runState.postExecuteFeedback.summary]
            : []),
          ...(deps.runState.lastPrepareError ? [deps.runState.lastPrepareError] : []),
          ...(deps.runState.lastToolError &&
          !deps.runState.lastPrepareError &&
          !deps.runState.postExecuteFeedback
            ? [deps.runState.lastToolError]
            : []),
        ],
        plannedNext: isEditTaskSatisfied(deps.runState)
          ? "用中文总结并结束。"
          : pendingLintFix
            ? "file.read 确认原文 → file.replace（精确子串）。"
            : "继续取证或 file.replace / patch.apply 写盘。",
        source: "runtime",
      });
      deps.pushReflectionToMessages(
        {
          understanding: deps.runState.userRequest,
          blockers: deps.runState.lastToolError ? [deps.runState.lastToolError] : [],
          plannedNext: "继续调用工具或写盘。",
          source: "runtime",
        },
        buildRuntimeCheckpoint(deps.runState),
      );
      deps.emitPlan({ lastAction: "reflect" });
    } else {
      deps.emitPlan({ lastAction: "tool" });
    }

    return { observationText, observationMessage, toolContext };
  } catch (error) {
    const observation = { error: deps.fallbackSummary(error) };
    recordToolCall(deps.runState, tool.name, observation, observation.error);
    deps.emit({
      type: "tool.completed",
      taskId: deps.taskId,
      toolCall: completeLoopToolCallRecord(toolCall, observation.error),
      result: observation,
    });

    const observationMessage = buildToolObservationMessage(
      tool.name,
      observation,
      observationCtx,
    );
    deps.runState.reflectionRounds += 1;
    deps.emitReflection({
      understanding: `工具 ${tool.name} 执行失败。`,
      blockers: [observation.error],
      plannedNext: "换策略后重试。",
      source: "runtime",
    });
    deps.pushReflectionToMessages(
      {
        understanding: `工具 ${tool.name} 执行失败。`,
        blockers: [observation.error],
        plannedNext: "换路径或 search 后重试。",
        source: "runtime",
      },
      buildRuntimeCheckpoint(deps.runState),
    );
    deps.emitPlan({ lastAction: "reflect" });

    return {
      observationText:
        typeof observationMessage.content === "string"
          ? observationMessage.content
          : JSON.stringify(observationMessage.content),
      observationMessage,
      toolContext: deps.getToolContext(),
    };
  }
}

export function shouldInterceptNativeFinal(
  runState: AgentLoopRunState,
  iteration: number,
  maxIterations: number,
): boolean {
  return (
    runState.likelyEditRequest &&
    !isExplicitReadOnlyRequest(runState.userRequest) &&
    !isEditTaskSatisfied(runState) &&
    runState.reflectionRounds < 4 &&
    iteration < maxIterations
  );
}

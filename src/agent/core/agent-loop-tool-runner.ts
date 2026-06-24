/**
 * Agent Loop 单工具执行（JSON / 原生 tool_calls 共用，A114）。
 */
import {
  getAgentLoopTool,
  type AgentLoopToolContext,
} from "@/agent/core/agent-loop-tools";
import {
  callMcpTool,
  isMcpInternalToolName,
  parseMcpInternalToolName,
  resolveMcpToolBinding,
} from "@/agent/mcp";
import { resolveFilePathArg, resolveUserSavePath } from "@/lib/user-path";
import {
  suggestMcpToolFallback,
  suggestMcpToolNotFound,
} from "@/agent/mcp/tool-fallback";
import {
  buildRuntimeCheckpoint,
  isExplicitReadOnlyRequest,
  recordToolCall,
  type AgentLoopRunState,
} from "@/agent/core/agent-loop-state";
import {
  emitDirectApplySideEffects,
  isDirectMutationToolName,
} from "@/agent/core/loop-direct-apply";
import { isEditTaskSatisfied } from "@/agent/core/agent-loop-state";
import {
  buildDeliverableCheckpointBlock,
  inferDeliverableProfile,
} from "@/agent/core/loop-deliverable";
import { captureUiPrepareHintFromFileRead } from "@/agent/core/ui-prepare-nudge";
import type { PlanProgressHint } from "@/agent/core/agent-loop-plan";
import {
  computePlaybookProgress,
  type ResolvedTaskPlaybook,
} from "@/agent/core/task-playbooks";
import { syncTaskEvidenceComplete } from "@/agent/core/evidence-gate";
import {
  buildReplicateAfterExtractNudge,
  buildReplicateEmptyWorkspaceNudge,
} from "@/agent/core/loop-replicate-nudge";
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
  emitPlan: (hint?: PlanProgressHint) => void;
  emitPlaybookProgress: () => void;
  playbook: ResolvedTaskPlaybook;
  fallbackSummary: (error: unknown) => string;
  pushUserNudge?: (content: string) => void;
};

export type AgentLoopToolRunResult = {
  observationText: string;
  observationMessage: AgentMessage;
  toolContext: AgentLoopToolContext;
  pendingShellApproval?: {
    approvalId: string;
    command: string;
  };
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
    if (isMcpInternalToolName(input.toolName)) {
      return runMcpLoopToolCall(input);
    }
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
    let pendingShellApproval: AgentLoopToolRunResult["pendingShellApproval"];
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
    deps.emitPlaybookProgress();
    syncTaskEvidenceComplete(deps.runState);

    if (tool.name === "workspace.inspect") {
      const emptyNudge = buildReplicateEmptyWorkspaceNudge(deps.runState);
      if (emptyNudge) {
        deps.pushUserNudge?.(emptyNudge);
      }
    }

    if (tool.name === "devtools.extract_design_spec") {
      const extractNudge = buildReplicateAfterExtractNudge(deps.runState);
      if (extractNudge) {
        deps.pushUserNudge?.(extractNudge);
      }
    }

    if (
      tool.name === "file.read" &&
      toolResult.result &&
      typeof toolResult.result === "object"
    ) {
      const readResult = toolResult.result as {
        path?: unknown;
        content?: unknown;
        error?: unknown;
      };
      if (
        typeof readResult.error === "string" &&
        /design-specs\/latest\.json/i.test(readResult.error)
      ) {
        deps.pushUserNudge?.(
          [
            "=== Design spec read hint ===",
            "Do NOT file.read .agent-state/design-specs/latest.json.",
            "Use devtools.get_persisted_design_spec, then file.mutation.prepare to write page files.",
          ].join("\n"),
        );
      }
    }

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
      if (approval.details?.kind === "shell_command") {
        const preview =
          toolResult.result &&
          typeof toolResult.result === "object" &&
          "preview" in toolResult.result
            ? (toolResult.result as { preview?: { command?: string } }).preview
            : undefined;
        pendingShellApproval = {
          approvalId: approval.id,
          command:
            preview?.command ??
            (approval.title.replace(/^Run\s+/i, "").trim() || approval.title),
        };
      }
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
        const bootstrapHint = await emitDirectApplySideEffects({
          taskId: deps.taskId,
          toolName: tool.name,
          rootPath: deps.rootPath,
          emit: deps.emit,
          runState: deps.runState,
          fileResult: directResult.mutation,
        });
        if (bootstrapHint) {
          deps.pushUserNudge?.(bootstrapHint);
        }
      } else if (tool.name === "patch.apply" && directResult.applied === true) {
        const bootstrapHint = await emitDirectApplySideEffects({
          taskId: deps.taskId,
          toolName: tool.name,
          rootPath: deps.rootPath,
          emit: deps.emit,
          runState: deps.runState,
          patchResult: directResult as PatchResult,
          patchText: input.patchTextFallback,
        });
        if (bootstrapHint) {
          deps.pushUserNudge?.(bootstrapHint);
        }
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
      const satisfied = isEditTaskSatisfied(deps.runState, deps.runState.playbookId);
      const pendingLintFix =
        Boolean(deps.runState.postExecuteFeedback) && !satisfied;
      const profile = inferDeliverableProfile({
        userRequest: deps.runState.userRequest,
        playbookId: deps.runState.playbookId,
      });
      const deliverableGap = buildDeliverableCheckpointBlock(
        deps.runState,
        deps.runState.playbookId,
      );
      deps.emitReflection({
        understanding: satisfied
          ? "交付物已满足，可中文总结。"
          : deps.runState.editApplied
            ? `已写盘但未满足交付标准：${profile.description}`
            : pendingLintFix
              ? "写盘后 lint 未通过，请修复。"
              : "任务未完成，需继续写盘或取证。",
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
        plannedNext: satisfied
          ? "用中文总结并结束。"
          : pendingLintFix
            ? "file.read 确认原文 → file.replace（精确子串）。"
            : deliverableGap
              ? "见 checkpoint 交付物提示，继续写页面/代码文件。"
              : "继续 file.mutation / file.replace 直到交付物齐。",
        source: "runtime",
      });
      deps.pushReflectionToMessages(
        {
          understanding: deps.runState.taskReasoning?.understanding ?? deps.runState.userRequest,
          blockers: deps.runState.lastToolError ? [deps.runState.lastToolError] : [],
          plannedNext: satisfied
            ? "总结并结束。"
            : "继续写盘直至满足交付标准。",
          source: "runtime",
        },
        buildRuntimeCheckpoint(deps.runState),
      );
      deps.emitPlan({ lastAction: "reflect" });
    } else {
      deps.emitPlan({ lastAction: "tool" });
    }

    return {
      observationText,
      observationMessage,
      toolContext,
      pendingShellApproval,
    };
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

async function runMcpLoopToolCall(input: {
  toolName: string;
  args: Record<string, unknown>;
  rationale?: string;
  toolCallId?: string;
  deps: AgentLoopToolRunnerDeps;
}): Promise<AgentLoopToolRunResult> {
  const { deps } = input;
  const binding =
    resolveMcpToolBinding(input.toolName) ??
    (() => {
      const parsed = parseMcpInternalToolName(input.toolName);
      return parsed
        ? { serverId: parsed.serverId, toolName: parsed.toolName }
        : null;
    })();

  if (!binding) {
    const suggested = suggestMcpToolNotFound(input.toolName);
    const observation = {
      error: suggested.error,
      hint: suggested.hint,
      ...(suggested.useInstead ? { useInstead: suggested.useInstead } : {}),
    };
    recordToolCall(deps.runState, input.toolName, observation, observation.error);
    const observationMessage = buildToolObservationMessage(
      input.toolName,
      observation,
      {
        workspaceRoot: deps.rootPath,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
      },
    );
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
    input.toolName,
    input.args,
    input.rationale,
  );
  const observationCtx = {
    workspaceRoot: deps.rootPath,
    toolName: input.toolName,
    toolCallId: input.toolCallId ?? toolCall.id,
  };

  deps.emit({ type: "tool.started", taskId: deps.taskId, toolCall });

  try {
    const result = await callMcpTool(
      binding,
      resolveFilePathArg(input.args, deps.rootPath),
    );
    recordToolCall(deps.runState, input.toolName, result);
    deps.emit({
      type: "tool.completed",
      taskId: deps.taskId,
      toolCall: completeLoopToolCallRecord(toolCall),
      result,
    });
    const observationMessage = buildToolObservationMessage(
      input.toolName,
      result,
      observationCtx,
    );
    return {
      observationText:
        typeof observationMessage.content === "string"
          ? observationMessage.content
          : JSON.stringify(observationMessage.content),
      observationMessage,
      toolContext: deps.getToolContext(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP tool failed";
    const fallback = suggestMcpToolFallback(binding.serverId, binding.toolName);
    const observation = {
      error: message,
      ...(fallback
        ? { useInstead: fallback.useInstead, hint: fallback.hint }
        : {
            hint: "调用 agent.diagnose 查看 MCP/CDP 状态，并改用内置 browser.* / devtools.*。",
          }),
    };
    recordToolCall(deps.runState, input.toolName, observation, message);
    deps.emit({
      type: "tool.completed",
      taskId: deps.taskId,
      toolCall: completeLoopToolCallRecord(toolCall, message),
      result: observation,
    });
    const observationMessage = buildToolObservationMessage(
      input.toolName,
      observation,
      observationCtx,
    );
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

import type { AgentEvent } from "@/agent/types";
import {
  buildKernelBootstrapSideEffect,
  isKernelAutoValidateEnabled,
} from "@/agent/core/kernel-bootstrap-policy";
import { prepareShellRun } from "@/agent/tools/shell-tools";
import { tagKernelBootstrapValidateApproval } from "@/lib/kernel-bootstrap-restart";

export async function emitKernelBootstrapValidateFlow(input: {
  taskId: string;
  rootPath: string;
  changedPaths: string[];
  emit: (event: AgentEvent) => void;
}): Promise<string | null> {
  const side = buildKernelBootstrapSideEffect(input.changedPaths);
  if (side.kernelPaths.length === 0) return null;

  let autoValidatePrepared = false;

  if (isKernelAutoValidateEnabled() && side.validateCommand) {
    try {
      const prepared = await prepareShellRun({
        rootPath: input.rootPath,
        taskId: input.taskId,
        command: side.validateCommand,
        createApproval: true,
      });
      if (prepared.approval && prepared.preview.available) {
        autoValidatePrepared = true;
        const approval = tagKernelBootstrapValidateApproval(
          prepared.approval,
          side.validateCommand ?? "",
        );
        input.emit({
          type: "approval.required",
          taskId: input.taskId,
          approval,
        });
      }
    } catch {
      /* fallback to hint-only */
    }
  }

  input.emit({
    type: "kernel.bootstrap.validate",
    taskId: input.taskId,
    paths: side.kernelPaths,
    validateScripts: side.validateScripts,
    validateCommand: side.validateCommand,
    requiresDevRestart: side.requiresDevRestart,
    autoValidatePrepared,
  });

  return side.followUp;
}

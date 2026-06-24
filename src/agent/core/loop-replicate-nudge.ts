/**
 * 页面复刻黄金路径：extract 后 / 写盘后轻量 nudge（不拦截工具）。
 */
import path from "node:path";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  hasPageUiDeliverable,
  isBareIndexHtmlOnly,
  isPageEntryPath,
  normalizeWrittenPath,
} from "@/agent/core/loop-deliverable";
import type { WorkspaceStructureFacts } from "@/agent/workspace/workspace-structure-facts";
import {
  isDesignReplicateRequest,
  type TaskPlaybookId,
} from "@/agent/core/task-playbooks";

export function isDesignReplicateTask(state: AgentLoopRunState): boolean {
  if (state.playbookId === "design-replicate") return true;
  return isDesignReplicateRequest(state.userRequest);
}

export function applyWorkspaceStructureToRunState(
  state: AgentLoopRunState,
  structure: WorkspaceStructureFacts,
): void {
  state.workspaceHasPackageJson = structure.hasPackageJson;
  state.workspaceLooksEmpty =
    !structure.hasPackageJson &&
    (structure.topLevelEntryCount === 0 ||
      structure.observations.some((o) =>
        /empty|no package\.json/i.test(o),
      ));
}

export function buildReplicateEmptyWorkspaceNudge(
  state: AgentLoopRunState,
): string | null {
  if (!isDesignReplicateTask(state)) return null;
  if (!state.workspaceLooksEmpty) return null;
  if (state.editApplied) return null;

  return [
    "=== Empty workspace — page replicate ===",
    "No package.json / app dirs detected. For static replicate use file.mutation (create):",
    "- index.html (page entry with real content from design spec)",
    "- styles.css (or inline styles in index if minimal)",
    "- main.js (optional interactivity)",
    "Flow: browser.open demo → devtools.extract_design_spec → devtools.get_persisted_design_spec → file.mutation writes.",
    "Do NOT stop after package.json only.",
  ].join("\n");
}

function inferLocalVerifyUrl(
  workspaceRoot: string,
  written: string[],
): string | null {
  const htmlEntry = written.find(
    (p) => isPageEntryPath(p) && /\.html$/i.test(normalizeWrittenPath(p)),
  );
  if (!htmlEntry) return null;
  const abs = path.join(workspaceRoot, normalizeWrittenPath(htmlEntry));
  return `file:///${abs.replaceAll("\\", "/")}`;
}

export function buildReplicateAfterExtractNudge(
  state: AgentLoopRunState,
): string | null {
  if (!isDesignReplicateTask(state)) return null;
  if (!state.toolsCalled.includes("devtools.extract_design_spec")) return null;
  if (hasPageUiDeliverable(state)) return null;

  return [
    "=== Page replicate — write phase ===",
    "Design spec is persisted in this workspace (.agent-state/design-specs).",
    "Next: devtools.get_persisted_design_spec (NOT file.read on latest.json), then file.mutation.prepare to create:",
    "- page entry (index.html or page.tsx)",
    "- at least one CSS file and one JS/TS file (or a component entry)",
    "Empty index.html alone does NOT complete the task.",
    "After write: browser.open the local file or dev URL to verify.",
  ].join("\n");
}

export function buildReplicateAfterWriteNudge(
  state: AgentLoopRunState,
  changedPaths: string[],
  workspaceRoot?: string,
): string | null {
  if (!isDesignReplicateTask(state)) return null;
  if (changedPaths.length === 0) return null;

  const written = (state.filesWritten ?? []).map(normalizeWrittenPath);
  if (hasPageUiDeliverable(state)) {
    const verifyUrl =
      workspaceRoot != null ? inferLocalVerifyUrl(workspaceRoot, written) : null;
    return [
      "=== Page replicate deliverable OK ===",
      `Written: ${written.join(", ")}`,
      verifyUrl
        ? `Verify: browser.open ${verifyUrl}`
        : "Open the page in browser (file:// or dev server) to visually verify, then final.",
    ].join("\n");
  }

  if (isBareIndexHtmlOnly(written)) {
    return [
      "=== Page replicate incomplete ===",
      "Only a bare index.html (or scaffold) is not enough.",
      "Add CSS + JS (or TSX component) with real layout/styles from design spec, then verify in browser.",
    ].join("\n");
  }

  return [
    "=== Page replicate incomplete ===",
    `Written so far: ${written.join(", ") || "(none)"}`,
    "Need: page entry + styles and/or logic files. Use get_persisted_design_spec and file.mutation.prepare.",
  ].join("\n");
}

export function replicatePlaybookIdForRecovery(
  state: AgentLoopRunState,
): TaskPlaybookId | undefined {
  return isDesignReplicateTask(state) ? "design-replicate" : state.playbookId;
}

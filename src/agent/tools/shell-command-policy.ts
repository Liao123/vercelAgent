/**
 * Shell 命令安全策略（对齐 Cursor：审批后可在 workspace 内执行，阻断明显破坏性命令）。
 */
import type { ApprovalRisk } from "@/agent/types";

export type ShellCommandValidation = {
  command: string;
  allowed: boolean;
  risk: ApprovalRisk;
  notes: string[];
  reason?: string;
};

const MAX_COMMAND_LENGTH = 4_000;

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/(?:\s|$)/i, reason: "blocked: rm -rf /" },
  { pattern: /\brm\s+-rf\s+~(?:\s|$|\/)/i, reason: "blocked: rm -rf ~" },
  { pattern: /\bformat\s+[a-z]:/i, reason: "blocked: format drive" },
  { pattern: /\bmkfs\./i, reason: "blocked: mkfs" },
  { pattern: /\bdd\s+if=/i, reason: "blocked: dd" },
  { pattern: /\b:\(\)\s*\{\s*:\|:&\s*\}\s*;/, reason: "blocked: fork bomb" },
  { pattern: /\bcurl[^\n|]*\|\s*(?:ba)?sh\b/i, reason: "blocked: curl|sh" },
  { pattern: /\bwget[^\n|]*\|\s*(?:ba)?sh\b/i, reason: "blocked: wget|sh" },
  { pattern: /\bpowershell(?:\.exe)?\s+-(?:enc|encodedcommand)\b/i, reason: "blocked: encoded powershell" },
  { pattern: /\breg\s+(?:add|delete)\b/i, reason: "blocked: registry mutation" },
  { pattern: /\bshutdown\s+\/(?:s|r|g)\b/i, reason: "blocked: shutdown" },
  { pattern: /\btaskkill\s+\/f\s+\/im\s+explorer/i, reason: "blocked: kill explorer" },
];

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bnpm\s+(?:install|i)\b/i,
  /\bnpm\s+uninstall\b/i,
  /\bnpm\s+ci\b/i,
  /\byarn\s+(?:add|remove)\b/i,
  /\bpnpm\s+(?:add|remove|install)\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/f/i,
  /\brmdir\s+\/s\b/i,
  /\bnpx\s+electron-builder\b/i,
];

const LOW_RISK_PATTERNS: RegExp[] = [
  /^npm\s+run\s+(?:lint|typecheck|test|validate:[\w:-]+|verify:[\w:-]+)\b/i,
  /^npx\s+--yes\s+tsx\s+scripts\/validate-/i,
  /^node\s+scripts\/(?:validate-|golden-path|trial-)/i,
  /^git\s+(?:status|diff|log|branch)\b/i,
];

export function normalizeShellCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

export function validateShellCommand(command: string): ShellCommandValidation {
  const normalized = normalizeShellCommand(command);
  const notes = [
    "Command runs in the workspace root directory after user approval.",
    "Output may be truncated in the UI.",
  ];

  if (!normalized) {
    return {
      command: normalized,
      allowed: false,
      risk: "medium",
      notes,
      reason: "Command is empty.",
    };
  }

  if (normalized.length > MAX_COMMAND_LENGTH) {
    return {
      command: normalized,
      allowed: false,
      risk: "high",
      notes,
      reason: `Command exceeds ${MAX_COMMAND_LENGTH} characters.`,
    };
  }

  if (normalized.includes("\0")) {
    return {
      command: normalized,
      allowed: false,
      risk: "high",
      notes,
      reason: "Command contains invalid characters.",
    };
  }

  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(normalized)) {
      return {
        command: normalized,
        allowed: false,
        risk: "high",
        notes,
        reason: blocked.reason,
      };
    }
  }

  let risk: ApprovalRisk = "medium";
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    risk = "high";
  } else if (LOW_RISK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    risk = "low";
  }

  return {
    command: normalized,
    allowed: true,
    risk,
    notes,
  };
}

export function classifyNpmScriptRisk(script: string): ApprovalRisk {
  if (/^(lint|typecheck|test|validate:|verify:)/i.test(script)) {
    return "low";
  }
  if (/^(build|pack:|electron|dev)/i.test(script)) {
    return "medium";
  }
  if (/^(start|postinstall|preinstall|prepare)$/i.test(script)) {
    return "high";
  }
  return "medium";
}

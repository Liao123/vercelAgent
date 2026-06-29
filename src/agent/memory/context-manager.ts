/**
 * Context Manager 骨架。
 *
 * 当前只负责把系统规则、项目规则、Thread/Task/Turn 信息整理成稳定的
 * ContextSection 和 AgentMessage。真正的压缩和 token 预算会在 A016/A017 继续做。
 */
import type {
  AgentMessage,
  AgentPlanStep,
  Task,
  Thread,
  Turn,
} from "@/agent/types";
import type {
  ContextBuildInput,
  ContextBuildResult,
  ContextSection,
  ContextSectionKind,
} from "@/agent/memory/types";
import {
  applyTokenBudget,
  DEFAULT_TOKEN_BUDGET,
} from "@/agent/memory/token-budget";

export const DEFAULT_AGENT_SYSTEM_INSTRUCTIONS = [
  "You are a local development agent.",
  "Respect project instructions and user constraints.",
  "Prefer reading relevant files before proposing code changes.",
  "Never write files, run shell commands, install dependencies, or perform git mutations without approval.",
  "Keep traceable summaries of decisions, read files, changed files, and verification results.",
].join("\n");

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function createSection(input: {
  id: string;
  kind: ContextSectionKind;
  title: string;
  content: string;
  priority: number;
  source?: string;
}): ContextSection {
  return {
    ...input,
    estimatedTokens: estimateTokens(input.content),
  };
}

function formatPlan(task: Task): string {
  const steps = task.plan?.steps ?? [];
  if (steps.length === 0) return "No plan yet.";

  return steps
    .map((step: AgentPlanStep) => `- [${step.status}] ${step.step || step.title || ""}`)
    .join("\n");
}

function formatThread(thread: Thread, summary?: string): string {
  return [
    `Thread: ${thread.title}`,
    `Thread status: ${thread.status}`,
    summary ? `Thread summary:\n${summary}` : "Thread summary: none yet.",
  ].join("\n");
}

function formatTask(task: Task, summary?: string): string {
  return [
    `Task request:\n${task.userRequest}`,
    `Task status: ${task.status}`,
    `Task summary:\n${summary ?? "none yet."}`,
    `Current plan:\n${formatPlan(task)}`,
  ].join("\n\n");
}

function formatTurn(turn: Turn): string {
  return [
    `Turn input:\n${turn.userInput}`,
    `Turn status: ${turn.status}`,
    turn.summary ? `Turn summary:\n${turn.summary}` : "Turn summary: none yet.",
  ].join("\n\n");
}

export function buildContextSections(
  input: ContextBuildInput,
): ContextSection[] {
  const sections: ContextSection[] = [
    createSection({
      id: "system:base",
      kind: "system",
      title: "System Instructions",
      content: input.systemInstructions,
      priority: 100,
    }),
  ];

  for (const rule of input.projectRules) {
    sections.push(
      createSection({
        id: `project-rule:${rule.path}`,
        kind: "project_rules",
        title: `Project Rule: ${rule.path}`,
        content: rule.content,
        priority: 90,
        source: rule.path,
      }),
    );
  }

  if (input.thread) {
    sections.push(
      createSection({
        id: `thread:${input.thread.id}`,
        kind: "thread_memory",
        title: "Thread Memory",
        content: formatThread(input.thread, input.threadSummary),
        priority: 75,
      }),
    );
  }

  if (input.task) {
    sections.push(
      createSection({
        id: `task:${input.task.id}`,
        kind: "task_memory",
        title: "Task Memory",
        content: formatTask(input.task, input.taskSummary),
        priority: 85,
      }),
    );
  }

  if (input.turn) {
    sections.push(
      createSection({
        id: `turn:${input.turn.id}`,
        kind: "turn_context",
        title: "Current Turn",
        content: formatTurn(input.turn),
        priority: 95,
      }),
    );
  }

  sections.push(...(input.retrievedContext ?? []));
  sections.push(...(input.toolResults ?? []));

  return sections.sort((a, b) => b.priority - a.priority);
}

export function buildContextMessages(
  sections: ContextSection[],
  recentMessages: AgentMessage[] = [],
): AgentMessage[] {
  const systemContent = sections
    .filter((section) => section.kind === "system")
    .map((section) => `# ${section.title}\n${section.content}`)
    .join("\n\n");

  const contextContent = sections
    .filter((section) => section.kind !== "system")
    .map((section) => `# ${section.title}\n${section.content}`)
    .join("\n\n");

  const messages: AgentMessage[] = [];
  if (systemContent) {
    messages.push({ role: "system", content: systemContent });
  }
  if (contextContent) {
    messages.push({
      role: "system",
      content: `Project and task context:\n\n${contextContent}`,
    });
  }
  messages.push(...recentMessages);
  return messages;
}

export function buildAgentContext(
  input: ContextBuildInput,
): ContextBuildResult {
  const sections = buildContextSections(input);
  const budget = applyTokenBudget(sections, DEFAULT_TOKEN_BUDGET);
  const messages = buildContextMessages(
    budget.includedSections,
    input.recentMessages,
  );

  return {
    sections: budget.includedSections,
    messages,
    estimatedTokens: budget.estimatedTokens,
  };
}

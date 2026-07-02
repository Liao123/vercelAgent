"use client";

import { AgentTurnChangeCard } from "@/components/agent-turn-change-card";
import { AgentMarkdown } from "@/components/agent-markdown";
import { TurnReasoningTimeline } from "@/components/agent-turn-reasoning-timeline";
import { TurnHighlightLine } from "@/components/agent-turn-worked-line";
import type { AgentTurnFeed } from "@/lib/agent-turn-feed";
import type { AgentEvent } from "@/agent/types";
import type { PostExecuteVerification } from "@/agent/verification";

type AgentTurnBlockProps = {
  turn: AgentTurnFeed;
  isLatest: boolean;
  running: boolean;
  onReviewApproval?: (approvalId: string, filePath?: string) => void;
  onReviewFileChange?: (filePath: string) => void;
  onApplyApproval?: (approvalId: string) => void;
  onRejectApproval?: (approvalId: string) => void;
  applyApprovalBusy?: boolean;
  pendingCommandApprovalIds?: Set<string>;
  executedCommandApprovalIds?: Set<string>;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  commandApprovalBusy?: boolean;
  showInlineFileChangeActions?: boolean;
  onFixLintAfterWrite?: (verification: PostExecuteVerification) => void;
};

function UserBubble({
  text,
  images = [],
}: {
  text: string;
  images?: string[];
}) {
  const showPlaceholderOnly =
    images.length > 0 && text === "请根据附图完成开发任务。";

  return (
    <div className="flex justify-end">
      <div className="max-w-[min(100%,40rem)] space-y-2 rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800/90">
        {!showPlaceholderOnly && text.trim().length > 0 && (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-zinc-900 dark:text-zinc-100">
            {text}
          </p>
        )}
        {images.length > 0 && (
          <div
            className={`flex flex-wrap gap-2 ${!showPlaceholderOnly && text.trim().length > 0 ? "pt-0.5" : ""}`}
          >
            {images.map((src, index) => (
              <a
                key={`user-img-${index}`}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-zinc-200/80 dark:border-zinc-600/80"
                title="点击查看大图"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`附图 ${index + 1}`}
                  className="max-h-48 max-w-full object-contain"
                />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-zinc-400 align-[-2px] dark:bg-zinc-500"
      aria-hidden
    />
  );
}

function AssistantMessage({
  body,
  tone = "neutral",
  streaming = false,
}: {
  body: string;
  tone?: "neutral" | "error" | "success";
  streaming?: boolean;
}) {
  if (tone === "error") {
    return (
      <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-red-700 dark:text-red-300">
        {body}
      </div>
    );
  }

  if (tone === "success") {
    return (
      <div className="whitespace-pre-wrap break-words rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-3 py-2.5 text-[13px] leading-[1.65] text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
        {body}
      </div>
    );
  }

  return (
    <div className="relative">
      <AgentMarkdown content={body} />
      {streaming && <StreamingCursor />}
    </div>
  );
}

export function AgentTurnBlock({
  turn,
  isLatest,
  running,
  onReviewApproval,
  onReviewFileChange,
  onApplyApproval,
  onRejectApproval,
  applyApprovalBusy = false,
  pendingCommandApprovalIds,
  executedCommandApprovalIds,
  onApproveCommand,
  onRejectCommand,
  commandApprovalBusy = false,
  showInlineFileChangeActions = true,
  onFixLintAfterWrite,
}: AgentTurnBlockProps) {
  const isActive = isLatest && running && turn.status === "running";
  const turnCompleted = turn.status === "completed" || turn.status === "failed";
  const hasTimeline = turn.narrativeEvents.length > 0;

  const completedSummary =
    turn.status === "completed"
      ? turn.summary
      : turn.status === "failed"
        ? turn.error
        : null;

  const liveThinking =
    isActive && turn.streamingPreview && !turn.summary
      ? turn.streamingPreview
      : null;

  const streamingAnswer =
    isActive && turn.summary && !completedSummary ? turn.summary : null;

  const summaryTone = turn.status === "failed" ? "error" : "neutral";
  const showStreaming = Boolean(streamingAnswer);
  const shouldShowFileChangeCard =
    Boolean(turn.fileChanges) &&
    (!isActive ||
      (showInlineFileChangeActions && turn.fileChanges?.status === "pending"));

  const approvalChatHighlights = turn.highlights.filter((event) => {
    if (event.type === "assistant.notice") return true;
    if (event.type === "approval.required" || event.type === "approval.executed") {
      return true;
    }
    if (event.type === "verification.completed") {
      return !turn.highlights.some((item) => item.type === "approval.executed");
    }
    return false;
  });

  const executedApprovalIds = new Set(
    approvalChatHighlights
      .filter(
        (event): event is Extract<AgentEvent, { type: "approval.executed" }> =>
          event.type === "approval.executed",
      )
      .map((event) => event.approvalId),
  );
  const commandNotices = approvalChatHighlights.filter(
    (event): event is Extract<AgentEvent, { type: "assistant.notice" }> =>
      event.type === "assistant.notice",
  );
  const commandDetailHighlights = approvalChatHighlights.filter((event) => {
    if (event.type === "assistant.notice") return false;
    if (
      event.type === "approval.required" &&
      executedApprovalIds.has(event.approval.id)
    ) {
      return false;
    }
    if (event.type === "verification.completed") {
      return !approvalChatHighlights.some(
        (item) => item.type === "approval.executed",
      );
    }
    return true;
  });

  return (
    <article className="space-y-4 pb-8">
      <UserBubble text={turn.userRequest} images={turn.referenceImages} />

      <div className="space-y-3">
        {(hasTimeline || liveThinking) && (
          <TurnReasoningTimeline
            narrativeEvents={turn.narrativeEvents}
            isActiveTurn={isActive}
            turnCompleted={turnCompleted}
            turnStartedAt={turn.createdAt}
            turnEndedAt={turn.completedAt}
            liveThinking={liveThinking}
            playbook={turn.playbook}
          />
        )}

        {isActive && !hasTimeline && !liveThinking && !streamingAnswer && !completedSummary && (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500">
            <span className="h-1 w-1 animate-pulse rounded-full bg-blue-500" />
            正在分析任务…
          </div>
        )}

        {streamingAnswer && (
          <AssistantMessage body={streamingAnswer} streaming={showStreaming} />
        )}

        {completedSummary && (
          <AssistantMessage body={completedSummary} tone={summaryTone} />
        )}

        {commandNotices.map((event, index) => (
          <AssistantMessage
            key={`notice-${index}`}
            body={event.message}
            tone={event.tone === "error" ? "error" : event.tone === "success" ? "success" : "neutral"}
          />
        ))}

        {commandDetailHighlights.map((event, index) => (
          <TurnHighlightLine
            key={`hl-${event.type}-${index}`}
            event={event}
            pendingCommandApprovalIds={pendingCommandApprovalIds}
            executedCommandApprovalIds={executedCommandApprovalIds}
            onApproveCommand={onApproveCommand}
            onRejectCommand={onRejectCommand}
            commandApprovalBusy={commandApprovalBusy}
          />
        ))}

        {shouldShowFileChangeCard && turn.fileChanges && (
          <AgentTurnChangeCard
            summary={turn.fileChanges}
            onReview={onReviewApproval}
            onReviewFileChange={onReviewFileChange}
            onApply={onApplyApproval}
            onReject={onRejectApproval}
            applyBusy={applyApprovalBusy}
            showInlineActions={showInlineFileChangeActions}
            postExecuteVerification={turn.postExecuteVerification}
            onFixLint={
              turn.postExecuteVerification && onFixLintAfterWrite
                ? () => onFixLintAfterWrite(turn.postExecuteVerification!)
                : undefined
            }
          />
        )}
      </div>
    </article>
  );
}

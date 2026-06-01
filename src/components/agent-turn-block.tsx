"use client";

import { AgentTurnChangeCard } from "@/components/agent-turn-change-card";
import { AgentMarkdown } from "@/components/agent-markdown";
import { TurnReasoningTimeline } from "@/components/agent-turn-reasoning-timeline";
import { TurnHighlightLine } from "@/components/agent-turn-worked-line";
import type { AgentTurnFeed } from "@/lib/agent-turn-feed";

type AgentTurnBlockProps = {
  turn: AgentTurnFeed;
  isLatest: boolean;
  running: boolean;
  onReviewApproval?: (approvalId: string, filePath?: string) => void;
  onRejectApproval?: (approvalId: string) => void;
};

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(100%,40rem)] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800/90">
        <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-zinc-900 dark:text-zinc-100">
          {text}
        </p>
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
  tone?: "neutral" | "error";
  streaming?: boolean;
}) {
  if (tone === "error") {
    return (
      <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-red-700 dark:text-red-300">
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
  onRejectApproval,
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

  const failedHighlights = turn.highlights.filter(
    (event) =>
      event.type === "verification.completed" && !event.result.success,
  );

  return (
    <article className="space-y-4 pb-8">
      <UserBubble text={turn.userRequest} />

      <div className="space-y-3">
        {(hasTimeline || liveThinking) && (
          <TurnReasoningTimeline
            narrativeEvents={turn.narrativeEvents}
            isActiveTurn={isActive}
            turnCompleted={turnCompleted}
            turnStartedAt={turn.createdAt}
            turnEndedAt={turn.completedAt}
            liveThinking={liveThinking}
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

        {failedHighlights.map((event, index) => (
          <TurnHighlightLine key={`hl-${index}`} event={event} />
        ))}

        {turn.fileChanges && (
          <AgentTurnChangeCard
            summary={turn.fileChanges}
            onReview={onReviewApproval}
            onReject={onRejectApproval}
          />
        )}
      </div>
    </article>
  );
}

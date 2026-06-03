export type ReviewDiffLayout = "split" | "unified";

export const REVIEW_DIFF_LAYOUT_KEY = "vec.agent.reviewDiffLayout";
export const REVIEW_DIFF_CHANGES_ONLY_KEY = "vec.agent.reviewDiffChangesOnly";

export function normalizeReviewDiffLayout(
  value: string | null | undefined,
): ReviewDiffLayout {
  return value === "unified" ? "unified" : "split";
}

export function normalizeReviewDiffChangesOnly(
  value: string | null | undefined,
): boolean {
  return value !== "0";
}

export function readReviewDiffLayout(): ReviewDiffLayout {
  if (typeof window === "undefined") return "split";
  return normalizeReviewDiffLayout(
    window.localStorage.getItem(REVIEW_DIFF_LAYOUT_KEY),
  );
}

export function writeReviewDiffLayout(layout: ReviewDiffLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVIEW_DIFF_LAYOUT_KEY, layout);
}

export function readReviewDiffChangesOnly(): boolean {
  if (typeof window === "undefined") return true;
  return normalizeReviewDiffChangesOnly(
    window.localStorage.getItem(REVIEW_DIFF_CHANGES_ONLY_KEY),
  );
}

export function writeReviewDiffChangesOnly(changesOnly: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    REVIEW_DIFF_CHANGES_ONLY_KEY,
    changesOnly ? "1" : "0",
  );
}

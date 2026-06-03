/**
 * A094：审查区 diff 布局偏好归一化。
 */
import assert from "node:assert/strict";
import {
  normalizeReviewDiffChangesOnly,
  normalizeReviewDiffLayout,
} from "../src/lib/agent-review-diff-prefs";

assert.equal(normalizeReviewDiffLayout(null), "split");
assert.equal(normalizeReviewDiffLayout("unified"), "unified");
assert.equal(normalizeReviewDiffLayout("split"), "split");
assert.equal(normalizeReviewDiffLayout("other"), "split");

assert.equal(normalizeReviewDiffChangesOnly(null), true);
assert.equal(normalizeReviewDiffChangesOnly("1"), true);
assert.equal(normalizeReviewDiffChangesOnly("0"), false);

console.log("validate-review-diff-prefs: passed");

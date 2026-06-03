/**
 * A095：strictPrepare 左栏偏好归一化。
 */
import assert from "node:assert/strict";
import { normalizeStrictPrepareLoop } from "../src/lib/agent-strict-prepare";

assert.equal(normalizeStrictPrepareLoop(null), false);
assert.equal(normalizeStrictPrepareLoop("0"), false);
assert.equal(normalizeStrictPrepareLoop("1"), true);
assert.equal(normalizeStrictPrepareLoop("yes"), false);

console.log("validate-strict-prepare-prefs: passed");

import assert from "node:assert/strict";
import { createAgentLoopRunState } from "../src/agent/core/agent-loop-state";
import {
  getModelVisibleLoopTools,
  getToolExposure,
  searchDeferredTools,
} from "../src/agent/core/tool-router";
import { buildLoopToolDefinitions } from "../src/agent/model/loop-tool-schemas";

function toolNamesFromDefinitions() {
  return buildLoopToolDefinitions()
    .map((tool) => tool.function.name)
    .sort();
}

const defaultTools = getModelVisibleLoopTools();
const defaultNames = new Set(defaultTools.map((tool) => tool.name));

assert.ok(defaultNames.has("tool.search"), "tool.search should be direct");
assert.ok(defaultNames.has("file.read"), "file.read should stay direct");
assert.ok(defaultNames.has("patch.apply"), "patch.apply should stay direct");
assert.ok(
  !defaultNames.has("devtools.get_computed_style"),
  "specialized devtools should be deferred by default",
);
assert.equal(getToolExposure("devtools.get_computed_style"), "deferred");
assert.equal(getToolExposure("file.read"), "direct");

const searchMatches = searchDeferredTools("css style color font", 5);
const styleMatch = searchMatches.find(
  (match) => match.name === "devtools.get_computed_style",
);
assert.ok(styleMatch, "tool.search should find computed style tooling");
assert.equal(
  styleMatch.args.selector,
  "CSS selector",
  "tool.search should return argument hints for unlocked tools",
);

const chineseMatches = searchDeferredTools(
  "\u622a\u56fe\u770b\u4e00\u4e0b\u9875\u9762\u6837\u5f0f",
  5,
);
assert.ok(
  chineseMatches.some((match) => match.name === "devtools.get_screenshot"),
  "tool.search should understand common Chinese tool queries",
);
assert.ok(
  searchDeferredTools("style", Number.NaN).length > 0,
  "tool.search should tolerate invalid limits",
);

const state = createAgentLoopRunState("inspect button color");
state.discoveredToolNames = ["devtools.get_computed_style"];
const unlockedDefinitions = buildLoopToolDefinitions(state);
const unlockedNames = new Set(
  unlockedDefinitions.map((tool) => tool.function.name),
);
assert.ok(
  unlockedNames.has("devtools_get_computed_style"),
  "discovered deferred tool should be visible to model",
);

const defaultSchemaNames = toolNamesFromDefinitions();
assert.ok(defaultSchemaNames.includes("tool_search"));
assert.ok(!defaultSchemaNames.includes("devtools_get_computed_style"));
assert.ok(!defaultSchemaNames.includes("file_replace_prepare"));

const strictState = createAgentLoopRunState("preview edit");
strictState.strictPrepare = true;
const strictSchemaNames = buildLoopToolDefinitions(strictState).map(
  (tool) => tool.function.name,
);
assert.ok(
  strictSchemaNames.includes("file_replace_prepare"),
  "strict prepare mode should expose prepare tools without a search roundtrip",
);

console.log("validate-tool-router: passed");

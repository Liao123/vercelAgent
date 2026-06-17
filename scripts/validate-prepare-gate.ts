import {
  createAgentLoopRunState,
  type AgentLoopRunState,
} from "../src/agent/core/agent-loop-state";
import {
  assertPrepareGate,
  extractExistingPatchPaths,
  hasUiLocationEvidence,
  isUiLocationQuery,
} from "../src/agent/core/prepare-gate";
import {
  GOLDEN_DISAMBIGUATION_LABEL,
  GOLDEN_UI_QUERY,
  PANEL_PATH,
  SIDEBAR_PATH,
} from "./golden-path-fixtures";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectGateError(runState: AgentLoopRunState, fn: () => void): string {
  try {
    fn();
    throw new Error("expected prepare gate to throw");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const uiQuery = GOLDEN_UI_QUERY;

assert(isUiLocationQuery(uiQuery), "homepage UI query should match");
assert(
  !isUiLocationQuery("读取 package.json 并总结依赖"),
  "non-UI query should not match",
);

const paths = extractExistingPatchPaths(`--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1,3 +1,2 @@
 line
--- /dev/null
+++ b/src/components/new.tsx
`);
assert(
  paths.includes("src/app/page.tsx") && !paths.includes("src/components/new.tsx"),
  "patch paths should include modified files only, not /dev/null creates",
);

const unreadState = createAgentLoopRunState(uiQuery);
unreadState.toolsCalled.push("file.locate");
const msgNoRead = expectGateError(unreadState, () =>
  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: [SIDEBAR_PATH],
    runState: unreadState,
  }),
);
assert(msgNoRead.includes("file.read"), msgNoRead);

const noLocateState = createAgentLoopRunState(uiQuery);
noLocateState.filesRead.push(SIDEBAR_PATH);
const msgNoLocate = expectGateError(noLocateState, () =>
  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: [SIDEBAR_PATH],
    runState: noLocateState,
  }),
);
assert(msgNoLocate.includes("ui.trace_from_page"), msgNoLocate);

const agentCoreState = createAgentLoopRunState(uiQuery);
agentCoreState.toolsCalled.push("file.locate");
agentCoreState.filesRead.push("src/agent/core/agent-loop.ts");
const msgAgentCore = expectGateError(agentCoreState, () =>
  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: ["src/agent/core/agent-loop.ts"],
    runState: agentCoreState,
  }),
);
assert(msgAgentCore.includes("agent 运行时"), msgAgentCore);

const okState = createAgentLoopRunState(uiQuery);
okState.toolsCalled.push("ui.trace_from_page", "file.read");
okState.filesRead.push(SIDEBAR_PATH);
assertPrepareGate({
  toolName: "file.replace.prepare",
  requiredReadPaths: [SIDEBAR_PATH],
  runState: okState,
});

const partialDisambigState = createAgentLoopRunState(uiQuery);
partialDisambigState.toolsCalled.push("file.locate");
partialDisambigState.disambiguation = {
  label: GOLDEN_DISAMBIGUATION_LABEL,
  mustReadPaths: [SIDEBAR_PATH, PANEL_PATH],
  recommendedPath: SIDEBAR_PATH,
  selectionRationale: "sidebar plus intent",
};
partialDisambigState.filesRead.push(SIDEBAR_PATH);
const msgPartialDisambig = expectGateError(partialDisambigState, () =>
  assertPrepareGate({
    toolName: "file.replace.prepare",
    requiredReadPaths: [SIDEBAR_PATH],
    runState: partialDisambigState,
  }),
);
assert(msgPartialDisambig.includes("多候选消歧"), msgPartialDisambig);

assert(
  hasUiLocationEvidence(["project.index", "file.locate"]),
  "file.locate should count as UI location evidence",
);

console.log("validate-prepare-gate: all assertions passed");

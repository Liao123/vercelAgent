import {
  createAgentLoopRunState,
  isExplicitReadOnlyRequest,
  isLikelyCodeEditRequest,
  recordToolCall,
} from "../src/agent/core/agent-loop-state";
import {
  reflectionBlockersLabel,
  formatReflectionBlockersLine,
} from "../src/lib/reflection-blockers-ui";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const readOnlyRequest =
  "【浏览器验证】只读任务：依次调用 workspace.inspect 和 git.status，不要修改任何文件。最后 action=final 用一句话汇报。";

assert(isExplicitReadOnlyRequest(readOnlyRequest), "read-only request should be explicit");
assert(
  !isLikelyCodeEditRequest(readOnlyRequest),
  "read-only request must not be classified as edit",
);

assert(
  isLikelyCodeEditRequest("把首页的鹊桥两个字去掉"),
  "plain edit request should still be detected",
);

assert(
  !isLikelyCodeEditRequest("只准备、不执行：读取 package.json 并总结依赖"),
  "prepare-only without execute should stay read-only",
);

assert(
  isLikelyCodeEditRequest("复刻首页写到当前项目"),
  "design-replicate write intent should be edit",
);

const state = createAgentLoopRunState("test");
recordToolCall(state, "devtools.get_screenshot", { error: "timeout" });
assert(state.lastToolError === "timeout", "error should be recorded");
recordToolCall(state, "browser.open", { url: "http://example.com" });
assert(state.lastToolError === undefined, "success clears stale lastToolError");

assert(
  reflectionBlockersLabel({ taskStillRunning: true, isLatestStep: true }) ===
    "待处理：",
  "latest step label",
);
assert(
  reflectionBlockersLabel({ taskStillRunning: true, isLatestStep: false }) ===
    "上轮问题：",
  "older step label",
);
assert(
  reflectionBlockersLabel({ taskStillRunning: false }) === "阻塞：",
  "completed label",
);
assert(
  formatReflectionBlockersLine(["timeout"], { taskStillRunning: true }).startsWith(
    "待处理：",
  ),
  "formatted line",
);

console.log("validate-loop-state: all assertions passed");

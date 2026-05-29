import {
  isExplicitReadOnlyRequest,
  isLikelyCodeEditRequest,
} from "../src/agent/core/agent-loop-state";

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

console.log("validate-loop-state: all assertions passed");

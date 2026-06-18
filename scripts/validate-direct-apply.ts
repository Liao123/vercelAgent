/**
 * A112：直接写盘工具（不经审批 prepare）。
 *
 * 运行：npm run validate:direct-apply
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  commitPreparedFileMutation,
  executeFileMutationDirect,
  prepareFileMutation,
} from "../src/agent/tools/file-mutations";
import { applyUnifiedPatchDirect } from "../src/agent/tools/patch-tools";
import { isDirectMutationToolName, isEditRecoveryEnabled } from "../src/agent/core/loop-direct-apply";
import { getAgentLoopTool } from "../src/agent/core/agent-loop-tools";

async function main(): Promise<void> {
  assert(isDirectMutationToolName("file.replace"));
  assert(isDirectMutationToolName("patch.apply"));
  assert.equal(isEditRecoveryEnabled(), process.env.AGENT_EDIT_RECOVERY === "1");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vec-direct-"));
  const relPath = "src/direct-apply-test.txt";
  const absPath = path.join(root, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, "hello world\n", "utf8");

  const applied = await executeFileMutationDirect({
    rootPath: root,
    taskId: "task_direct_test",
    operation: {
      type: "write",
      path: relPath,
      content: "hello vec-next\n",
    },
  });
  assert.equal(applied.applied, true);
  const onDisk = await fs.readFile(absPath, "utf8");
  assert.equal(onDisk, "hello vec-next\n");

  const patch = `--- a/${relPath}
+++ b/${relPath}
@@ -1 +1 @@
-hello vec-next
+hello patch
`;
  const patchResult = await applyUnifiedPatchDirect({ rootPath: root, patch });
  assert.equal(patchResult.applied, true);
  assert.ok(patchResult.files.some((file) => file.changed));
  const afterPatch = await fs.readFile(absPath, "utf8");
  assert.equal(afterPatch, "hello patch\n");

  const prepared = await prepareFileMutation({
    rootPath: root,
    taskId: "task_direct_test",
    operation: { type: "write", path: relPath, content: "via commit\n" },
    createApproval: false,
  });
  await commitPreparedFileMutation(root, prepared);
  assert.equal(await fs.readFile(absPath, "utf8"), "via commit\n");

  assert.ok(getAgentLoopTool("file.replace"));
  assert.ok(getAgentLoopTool("patch.apply"));
  assert.ok(getAgentLoopTool("file.mutation"));

  await fs.rm(root, { recursive: true, force: true });
  console.log("validate-direct-apply: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

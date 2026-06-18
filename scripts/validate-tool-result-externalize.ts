/**
 * A115：大 tool 结果外置到 `.agent-state/tool-results/`。
 *
 * 运行：npm run validate:tool-result-externalize
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildToolObservationMessage,
  shapeToolResultForObservation,
} from "../src/agent/memory/loop-context-compactor";
import {
  FILE_READ_INLINE_MAX,
  getToolResultStorageRelPath,
  isToolResultExternalizeEnabled,
  readExternalizedToolResult,
  TOOL_RESULT_INLINE_MAX,
} from "../src/agent/memory/tool-result-storage";

assert.equal(isToolResultExternalizeEnabled(), true);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vec-tr-ext-"));
const ctx = { workspaceRoot: tmpRoot, toolName: "file.read", toolCallId: "call_test_1" };

const hugeContent = "export const line = 1;\n".repeat(900);
const fileReadPayload = {
  path: "src/huge.ts",
  content: hugeContent,
  size: hugeContent.length,
};

const shaped = shapeToolResultForObservation("file.read", fileReadPayload, ctx) as Record<
  string,
  unknown
>;
assert.equal(shaped.externalized, true);
assert.equal(shaped.path, "src/huge.ts");
assert.ok(typeof shaped.storagePath === "string");
assert.ok(String(shaped.storagePath).includes(".agent-state/tool-results/"));

const storageAbs = path.join(tmpRoot, String(shaped.storagePath));
assert.ok(fs.existsSync(storageAbs), "externalized file should exist on disk");

const restored = readExternalizedToolResult(tmpRoot, String(shaped.storagePath)) as {
  content?: string;
};
assert.equal(restored.content, hugeContent);

const observation = buildToolObservationMessage("file.read", fileReadPayload, ctx);
const obsText = String(observation.content);
assert.ok(obsText.includes("externalized"));
assert.ok(obsText.length < FILE_READ_INLINE_MAX + 500);

const bulky = { rows: "y".repeat(TOOL_RESULT_INLINE_MAX + 2_000) };
const shapedBulky = shapeToolResultForObservation(
  "analysis.dump",
  bulky,
  { workspaceRoot: tmpRoot, toolName: "analysis.dump" },
) as Record<string, unknown>;
assert.equal(shapedBulky.externalized, true);

process.env.AGENT_TOOL_RESULT_EXTERNALIZE = "0";
const truncated = shapeToolResultForObservation("file.read", fileReadPayload, ctx) as Record<
  string,
  unknown
>;
assert.equal(truncated.externalized, undefined);
assert.equal(truncated.truncated, true);
delete process.env.AGENT_TOOL_RESULT_EXTERNALIZE;

assert.ok(getToolResultStorageRelPath("abc").endsWith("tool-results/abc.json"));

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log("validate-tool-result-externalize: passed");

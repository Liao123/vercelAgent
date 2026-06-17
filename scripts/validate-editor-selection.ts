/**
 * A108：@ 提及 + 审查区选区行号。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  mergeAttachedSelections,
  parseAtPathsFromRequest,
  preloadAttachedFiles,
} from "../src/agent/core/attached-files";
import {
  formatMentionLineRange,
  splitMentionToken,
} from "../src/lib/review-editor-selection";

async function main(): Promise<void> {
  assert.equal(formatMentionLineRange(10, 10), "#L10");
  assert.equal(formatMentionLineRange(10, 25), "#L10-25");

  const token = splitMentionToken("src/a.tsx#L12-18");
  assert.equal(token.path, "src/a.tsx");
  assert.equal(token.startLine, 12);
  assert.equal(token.endLine, 18);

  const parsed = parseAtPathsFromRequest(
    "请改 @src/components/agent-panel.tsx#L40-55 的按钮",
  );
  assert.deepEqual(parsed.attachedPaths, ["src/components/agent-panel.tsx"]);
  assert.equal(parsed.attachedSelections.length, 1);
  assert.equal(parsed.attachedSelections[0]?.startLine, 40);
  assert.match(parsed.cleanRequest, /agent-panel\.tsx/);
  assert.doesNotMatch(parsed.cleanRequest, /@|#L/);

  const merged = mergeAttachedSelections(
    [{ path: "src/a.tsx", startLine: 1, endLine: 3 }],
    parsed.attachedSelections,
  );
  assert.equal(merged.length, 2);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vec-editor-sel-"));
  const filePath = path.join(root, "src", "demo.ts");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    ["line1", "line2", "line3", "line4", "line5"].join("\n"),
    "utf8",
  );

  const preloaded = await preloadAttachedFiles({
    rootPath: root,
    paths: ["src/demo.ts"],
    selections: [{ path: "src/demo.ts", startLine: 2, endLine: 4 }],
  });
  assert.equal(preloaded[0]?.content, "line2\nline3\nline4");

  const panel = await fs.readFile(
    path.join(process.cwd(), "src/components/agent-panel.tsx"),
    "utf8",
  );
  assert.ok(panel.includes("reviewEditorSelection"), "panel tracks review selection");
  assert.ok(panel.includes("attachedSelections"), "panel sends selection to loop");

  const loopRoute = await fs.readFile(
    path.join(process.cwd(), "src/app/api/agent/loop/route.ts"),
    "utf8",
  );
  assert.ok(loopRoute.includes("attachedSelections"), "loop API accepts selections");

  console.log("validate-editor-selection: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

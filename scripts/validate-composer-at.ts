import assert from "node:assert/strict";
import {
  listWorkspaceFileHints,
  suggestFilePaths,
} from "../src/agent/tools/file-tools";
import {
  extractAtMentionPaths,
  insertAtMention,
  mergePathSuggestions,
  isCommittedAtMention,
  parseActiveAtQuery,
  parseRequestSegments,
  removeTextRange,
  requestContainsAtPath,
  resolveMentionDeleteRange,
  resolveMentionArrowCursor,
} from "../src/lib/composer-at-mention";

async function main(): Promise<void> {
  const parsed = parseActiveAtQuery("改 @agent-com", "改 @agent-com".length);
  assert.ok(parsed);
  assert.equal(parsed!.query, "agent-com");

  const merged = mergePathSuggestions(
    "composer",
    ["src/components/agent-composer.tsx"],
    ["src/components/agent-panel.tsx"],
  );
  assert.ok(merged[0]?.includes("agent-composer"));

  const inserted = insertAtMention("请改 @agen", 4, 9, "src/foo.ts");
  assert.ok(inserted.nextText.includes("@src/foo.ts "));
  assert.ok(inserted.nextText.endsWith("@src/foo.ts "));

  const tailPick = insertAtMention("看 @", 2, 3, "src/a.ts");
  assert.ok(tailPick.nextText.endsWith("@src/a.ts "));

  const committed = "请 @src/foo.ts ";
  assert.ok(isCommittedAtMention(committed, committed.indexOf("@"), committed.length));
  assert.equal(
    parseActiveAtQuery(committed, committed.length),
    null,
    "committed mention at end should not reopen picker",
  );

  const typing = "请 @agen";
  assert.equal(parseActiveAtQuery(typing, typing.length)?.query, "agen");

  const paths = await suggestFilePaths(process.cwd(), "agent-composer", 8);
  assert.ok(
    paths.some((p) => p.replaceAll("\\", "/").includes("agent-composer.tsx")),
    `expected composer in suggestions, got ${paths.join(", ")}`,
  );

  const hints = await listWorkspaceFileHints(process.cwd(), 8);
  assert.ok(hints.length > 0, "empty-query file hints should not be empty");

  const emptyAt = parseActiveAtQuery("改 @", "改 @".length);
  assert.ok(emptyAt);
  assert.equal(emptyAt!.query, "");

  const extracted = extractAtMentionPaths(
    "请改 @src/components/agent-composer.tsx 谢谢",
  );
  assert.ok(extracted[0]?.includes("agent-composer.tsx"));
  assert.ok(
    requestContainsAtPath(
      "请改 @src/components/agent-composer.tsx 谢谢",
      "src/components/agent-composer.tsx",
    ),
  );
  const segments = parseRequestSegments("看 @api/main.mjs 吧");
  assert.equal(segments.filter((s) => s.type === "mention").length, 1);

  const sample = "请 @src/foo.ts 改";
  const del = resolveMentionDeleteRange(sample, 4, 4, "Backspace");
  assert.ok(del);
  const removed = removeTextRange(sample, del!.start, del!.end);
  assert.ok(!removed.nextText.includes("@src/foo.ts"));
  assert.equal(removed.nextCursor, del!.start);

  const arrowText = "a @src/foo.ts b";
  assert.equal(
    resolveMentionArrowCursor(arrowText, 12, "left"),
    2,
  );
  assert.equal(
    resolveMentionArrowCursor(arrowText, 2, "right"),
    arrowText.indexOf("b"),
  );

  console.log("validate-composer-at: passed", {
    sample: paths.slice(0, 3),
    hints: hints.slice(0, 3),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

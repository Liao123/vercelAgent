/**
 * A080：压缩 pin filesRead 片段 + @path 附加文件解析。
 *
 * 运行：npm run validate:attached-pin
 */
import assert from "node:assert/strict";
import {
  formatAttachedFilesUserNote,
  mergeAttachedPaths,
  parseAtPathsFromRequest,
} from "../src/agent/core/attached-files";
import {
  buildStructuredCompactedMemory,
  buildToolObservationMessage,
  compactAgentLoopMessages,
  parseCompactedMemory,
} from "../src/agent/memory/loop-context-compactor";
import {
  extractFileReadSnippetsFromMessages,
  parsePinnedFileSnippetsFromBlock,
} from "../src/agent/memory/loop-files-read-pin";
import { emptyPinnedFacts } from "../src/agent/memory/loop-pinned-facts";
import type { AgentMessage } from "../src/agent/types";

function buildFileReadMessages(paths: string[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const path of paths) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path },
      }),
    });
    messages.push(
      buildToolObservationMessage("file.read", {
        path,
        content: `// content of ${path}\nexport const marker_${path.replace(/\W/g, "_")} = true;\n`,
      }),
    );
  }
  return messages;
}

async function main() {
  const parsed = parseAtPathsFromRequest(
    "请修改 @src/components/agent-composer.tsx 去掉 Loop 选择",
  );
  assert.deepEqual(parsed.attachedPaths, ["src/components/agent-composer.tsx"]);
  assert.match(parsed.cleanRequest, /agent-composer\.tsx/);
  assert.doesNotMatch(parsed.cleanRequest, /@/);

  const merged = mergeAttachedPaths(
    ["src/components/agent-panel.tsx"],
    parsed.attachedPaths,
  );
  assert.equal(merged.length, 2);
  assert.ok(merged.includes("src/components/agent-panel.tsx"));

  const note = formatAttachedFilesUserNote(merged);
  assert.match(note, /ATTACHED_FILES/);
  assert.match(note, /agent-composer\.tsx/);

  const snippets = extractFileReadSnippetsFromMessages(
    buildFileReadMessages([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
      "src/f.ts",
      "src/g.ts",
    ]),
    { filesReadPaths: ["src/a.ts", "src/g.ts"], maxFiles: 4 },
  );
  assert.equal(snippets.length, 4);
  assert.equal(snippets[0].path, "src/g.ts");
  assert.equal(snippets[1].path, "src/a.ts");

  const memory = buildStructuredCompactedMemory({
    round: 2,
    method: "deterministic",
    pinnedFacts: emptyPinnedFacts(),
    summaryBody: "Read composer for loop UI.",
    changedFiles: ["src/components/agent-composer.tsx"],
    pinnedFileSnippets: snippets.slice(0, 2),
  });
  assert.match(memory, /## 钉住文件片段/);
  assert.match(memory, /src\/g\.ts/);

  const roundtrip = parseCompactedMemory(memory);
  assert.ok(roundtrip);
  assert.equal(roundtrip.pinnedFileSnippets.length, 2);
  assert.equal(
    parsePinnedFileSnippetsFromBlock(
      memory.split("## 钉住文件片段")[1]?.split("## 摘要")[0] ?? "",
    ).length,
    2,
  );

  const messages: AgentMessage[] = [
    { role: "system", content: "agent" },
    { role: "user", content: "long task with many reads" },
  ];
  for (let i = 0; i < 10; i += 1) {
    const path = `src/module-${i}.ts`;
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        action: "tool_call",
        tool: "file.read",
        args: { path },
      }),
    });
    messages.push(
      buildToolObservationMessage("file.read", {
        path,
        content: `export const n${i} = ${i};\n`.repeat(120),
      }),
    );
    messages.push({
      role: "user",
      content: `Reflection (runtime): checkpoint after step ${i}`,
    });
  }

  const compact = await compactAgentLoopMessages({
    messages,
    userRequest: "long task with many reads",
    enableSemanticCompact: false,
    filesReadPaths: [
      "src/module-0.ts",
      "src/module-9.ts",
      "src/module-5.ts",
    ],
  });
  assert.notEqual(compact.method, "none");
  assert.match(compact.memoryContent ?? "", /## 钉住文件片段/);
  assert.match(compact.memoryContent ?? "", /### src\/module-/);
  const compactParsed = parseCompactedMemory(compact.memoryContent ?? "");
  assert.ok(compactParsed);
  assert.ok(compactParsed.pinnedFileSnippets.length >= 1);
  assert.ok(
    compactParsed.pinnedFileSnippets.some((item) =>
      item.path.includes("module-9"),
    ),
  );

  console.log("validate-attached-pin: passed");
}

void main();

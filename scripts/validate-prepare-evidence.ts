import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildPrepareEvidenceFromSearch,
  buildPrepareEvidenceFromContentChange,
} from "../src/agent/approval/prepare-evidence";

async function main(): Promise<void> {
  const composerPath = "src/components/agent-composer.tsx";
  const content = await fs.readFile(composerPath, "utf8");
  const search = "闭环";

  const evidence = buildPrepareEvidenceFromSearch({
    path: composerPath,
    content,
    search,
    source: "file.replace.prepare",
  });

  assert.ok(evidence.matchedSnippet.includes(search), "snippet contains search");
  assert.ok(evidence.startLine >= 1, "startLine >= 1");
  assert.ok(evidence.endLine >= evidence.startLine, "endLine >= startLine");
  assert.equal(evidence.searchText, search);
  assert.equal(evidence.path, composerPath);

  const oldContent = "line1\nline2\nTARGET\nline4\n";
  const newContent = "line1\nline2\nCHANGED\nline4\n";
  const diffEvidence = buildPrepareEvidenceFromContentChange({
    path: "test.tsx",
    oldContent,
    newContent,
    source: "file.mutation.prepare",
  });

  assert.ok(diffEvidence, "diff evidence should exist");
  assert.ok(
    diffEvidence!.matchedSnippet.includes("TARGET"),
    "diff evidence should include changed region",
  );

  console.log("validate-prepare-evidence: passed", {
    composerLines: `${evidence.startLine}-${evidence.endLine}`,
    diffLines: `${diffEvidence!.startLine}-${diffEvidence!.endLine}`,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

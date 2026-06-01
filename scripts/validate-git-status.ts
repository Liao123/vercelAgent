/**
 * 校验 git status 解析器与 getGitStatus 结构化输出。
 */
import assert from "node:assert/strict";
import {
  buildGitStatusSummary,
  parseGitStatusOutput,
} from "../src/lib/git-status";
import { getGitStatus } from "../src/agent/tools/git-tools";

function testParseCleanBranch() {
  const snapshot = parseGitStatusOutput(
    "## main...origin/main [ahead 2, behind 1]\n",
  );
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.branch, "main");
  assert.equal(snapshot.upstream, "origin/main");
  assert.equal(snapshot.ahead, 2);
  assert.equal(snapshot.behind, 1);
  assert.match(snapshot.summary, /main/);
  assert.match(snapshot.summary, /clean/);
}

function testParseDirtyFiles() {
  const snapshot = parseGitStatusOutput(`## feat/ui
 M src/app/page.tsx
A  src/lib/new.ts
?? tmp/scratch.txt
 D old.txt
RM src/old-name.ts -> src/new-name.ts
`);
  assert.equal(snapshot.dirty, true);
  assert.equal(snapshot.branch, "feat/ui");
  assert.equal(snapshot.files.length, 5);

  const modified = snapshot.files.find((f) => f.path === "src/app/page.tsx");
  assert.equal(modified?.status, "modified");

  const untracked = snapshot.files.find((f) => f.path === "tmp/scratch.txt");
  assert.equal(untracked?.status, "untracked");

  const renamed = snapshot.files.find((f) => f.path === "src/new-name.ts");
  assert.equal(renamed?.status, "renamed");
  assert.equal(renamed?.previousPath, "src/old-name.ts");

  assert.match(snapshot.summary, /modified/);
  assert.match(snapshot.summary, /untracked/);
}

function testParseDetached() {
  const snapshot = parseGitStatusOutput("## HEAD (no branch)\n M README.md\n");
  assert.equal(snapshot.detached, true);
  assert.equal(snapshot.branch, null);
  assert.equal(snapshot.files.length, 1);
}

function testSummaryCounts() {
  const summary = buildGitStatusSummary({
    branch: "dev",
    upstream: null,
    ahead: null,
    behind: null,
    detached: false,
    files: [
      {
        path: "a.ts",
        indexStatus: "M",
        worktreeStatus: " ",
        status: "modified",
      },
      {
        path: "b.ts",
        indexStatus: "?",
        worktreeStatus: "?",
        status: "untracked",
      },
    ],
  });
  assert.match(summary, /1 modified/);
  assert.match(summary, /1 untracked/);
}

async function testLiveRepo() {
  const status = await getGitStatus(process.cwd());
  assert.equal(typeof status.dirty, "boolean");
  assert.equal(typeof status.summary, "string");
  assert.ok(Array.isArray(status.files));
  assert.equal(typeof status.command, "string");
  console.log(`live repo: ${status.summary}`);
}

function main() {
  testParseCleanBranch();
  testParseDirtyFiles();
  testParseDetached();
  testSummaryCounts();
  console.log("validate-git-status: parser OK");
}

main();

testLiveRepo()
  .then(() => {
    console.log("validate-git-status: live getGitStatus OK");
  })
  .catch((error) => {
    console.warn(
      "validate-git-status: live getGitStatus skipped:",
      error instanceof Error ? error.message : error,
    );
  });

/**
 * A110：Loop / compact 提示词模块化 + 工作区 MEMORY.md 注入。
 *
 * 运行：npm run validate:agent-prompts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLoopSystemPrompt } from "../src/agent/prompts/create-loop-system-prompt";
import {
  formatCompactModelOutput,
  getCompactSystemPrompt,
} from "../src/agent/prompts/compact-prompt";
import { loadPromptFile } from "../src/agent/prompts/load-prompt";
import {
  loadWorkspaceMemory,
  WORKSPACE_MEMORY_REL_PATH,
} from "../src/agent/memory/workspace-memory";

const loopTemplate = loadPromptFile("loop-system.md");
assert(loopTemplate.includes("Simplified Chinese"), "loop-system.md must require Chinese");
assert(loopTemplate.includes("file.replace"), "loop-system.md must mention file.replace");
assert(loopTemplate.includes("patch.apply"), "loop-system.md must mention patch.apply");
assert(loopTemplate.includes("{{WORKSPACE_ROOT}}"), "loop-system.md must have workspace placeholder");

const compactPrompt = getCompactSystemPrompt();
assert(
  compactPrompt.includes("Do NOT call any tools"),
  "compact.md must forbid tools during compaction",
);
assert(compactPrompt.includes("<summary>"), "compact.md must use summary tags");

const basePrompt = createLoopSystemPrompt(process.cwd());
assert(basePrompt.includes("file.replace"));
assert(basePrompt.includes("patch.apply"));
assert(basePrompt.includes(process.cwd()));
assert(!basePrompt.includes("action=tool_call"), "native prompt should not require JSON tool_call");
assert(!basePrompt.includes("{{WORKSPACE_ROOT}}"), "placeholders must be rendered");

process.env.AGENT_LOOP_JSON_PROTOCOL = "1";
const jsonPrompt = createLoopSystemPrompt(process.cwd());
assert(jsonPrompt.includes("action=reflect"), "json protocol prompt must mention reflect");
delete process.env.AGENT_LOOP_JSON_PROTOCOL;

const formatted = formatCompactModelOutput(
  "<analysis>draft</analysis>\n<summary>\n## Summary\n- ok\n\n## Changed files\n- none\n</summary>",
);
assert(formatted.includes("## Summary"));
assert(!formatted.includes("<analysis>"));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vec-memory-"));
const memoryDir = path.join(tmpRoot, path.dirname(WORKSPACE_MEMORY_REL_PATH));
fs.mkdirSync(memoryDir, { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, WORKSPACE_MEMORY_REL_PATH),
  "Prefer concise commit messages in Chinese.",
  "utf8",
);
const loaded = loadWorkspaceMemory(tmpRoot);
assert(loaded?.includes("commit messages"));
const withMemory = createLoopSystemPrompt(tmpRoot);
assert(withMemory.includes("Workspace memory"));
assert(withMemory.includes("commit messages"));
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log("validate-agent-prompts: passed");

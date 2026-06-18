/**
 * A114：原生 tool loop（OpenAI tools API，对标 Claude Code query.ts tool_use 链）。
 *
 * 运行：npm run validate:native-tool-loop
 */
import assert from "node:assert/strict";
import { isNativeToolLoopEnabled, isJsonLoopProtocolForced } from "../src/agent/core/loop-protocol";
import {
  buildLoopToolDefinitions,
  decodeOpenAiToolName,
  encodeOpenAiToolName,
  parseOpenAiToolCalls,
  parseToolCallArguments,
  serializeAgentMessagesForOpenAiApi,
} from "../src/agent/model/loop-tool-schemas";
import { createLoopSystemPrompt } from "../src/agent/prompts/create-loop-system-prompt";

assert.equal(isNativeToolLoopEnabled(), true, "native tool loop should be default");

process.env.AGENT_LOOP_JSON_PROTOCOL = "1";
assert.equal(isNativeToolLoopEnabled(), false);
assert.equal(isJsonLoopProtocolForced(), true);
delete process.env.AGENT_LOOP_JSON_PROTOCOL;

const tools = buildLoopToolDefinitions();
assert.ok(tools.length >= 20, "should expose full loop tool registry");
assert.equal(encodeOpenAiToolName("file.replace"), "file_replace");
assert.ok(tools.some((tool) => tool.function.name === "file_replace"));
assert.ok(tools.every((tool) => !tool.function.name.includes(".")));
assert.equal(decodeOpenAiToolName("file_read"), "file.read");

const parsedArgs = parseToolCallArguments('{"path":"src/a.ts","search":"x","replace":"y"}');
assert.equal(parsedArgs.path, "src/a.ts");

const toolCalls = parseOpenAiToolCalls({
  tool_calls: [
    {
      id: "call_1",
      type: "function",
      function: { name: "file_read", arguments: '{"path":"src/a.ts"}' },
    },
  ],
});
assert.equal(toolCalls.length, 1);
assert.equal(toolCalls[0]!.name, "file.read");

const serialized = serializeAgentMessagesForOpenAiApi([
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "file.read", arguments: "{}" },
      },
    ],
  },
]);
assert.equal(serialized[0]?.tool_calls?.[0]?.function.name, "file_read");

const nativePrompt = createLoopSystemPrompt(process.cwd());
assert.ok(!nativePrompt.includes("action=tool_call"), "native prompt should not require JSON");
assert.ok(nativePrompt.includes("file.replace"));

process.env.AGENT_LOOP_JSON_PROTOCOL = "1";
const jsonPrompt = createLoopSystemPrompt(process.cwd());
assert.ok(jsonPrompt.includes("action=reflect") || jsonPrompt.includes("JSON"));
delete process.env.AGENT_LOOP_JSON_PROTOCOL;

console.log("validate-native-tool-loop: passed");

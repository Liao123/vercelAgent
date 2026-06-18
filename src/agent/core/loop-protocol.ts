/**
 * A114：Loop 协议选择（原生 tool_calls vs 遗留 JSON 决策）。
 *
 * 默认原生 tool loop（对标 Claude Code query.ts + OpenAI tools API）。
 * 设 AGENT_LOOP_JSON_PROTOCOL=1 可回退旧 JSON 协议（试用/对比）。
 */
export function isNativeToolLoopEnabled(): boolean {
  return process.env.AGENT_LOOP_JSON_PROTOCOL !== "1";
}

export function isJsonLoopProtocolForced(): boolean {
  return process.env.AGENT_LOOP_JSON_PROTOCOL === "1";
}

import type { ChatResponse } from "../src/model-layer/gateway.ts";

// A chat reply with text, or with a call to the submit_result tool.
export function reply(content: string | null, toolArguments?: string): ChatResponse {
  const tool_calls = toolArguments
    ? [{ function: { name: "submit_result", arguments: toolArguments } }]
    : undefined;
  return { choices: [{ message: { content, ...(tool_calls ? { tool_calls } : {}) } }] };
}

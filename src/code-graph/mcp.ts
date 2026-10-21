import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Logger } from "../runtime/logger.ts";

// A Model Context Protocol server over stdio, as small as a read-only tool
// server needs: newline-delimited JSON-RPC 2.0 with initialize, ping,
// tools/list, and tools/call. Each line out is one whole message; logs go to
// stderr, because anything else on stdout would break the client's parser.

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export type Service = {
  name: string;
  version: string;
  tools: ToolSpec[];
  call(name: string, args: Record<string, unknown>): ToolResult;
};

// Newest first; a client asking for another version gets the newest.
const protocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Id = string | number | null;
type Reply = { jsonrpc: "2.0"; id: Id } & ({ result: unknown } | { error: RpcError });
type RpcError = { code: number; message: string };

const parseError = { code: -32700, message: "Parse error: each line must be one JSON object." };
const invalidRequest = { code: -32600, message: "Invalid request: expected a JSON-RPC 2.0 call." };
const invalidParams = (message: string) => ({ code: -32602, message });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function initialize(service: Service, params: Record<string, unknown>) {
  const asked = params.protocolVersion;
  const protocolVersion =
    typeof asked === "string" && protocolVersions.includes(asked) ? asked : protocolVersions[0];
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: service.name, version: service.version },
  };
}

function callTool(service: Service, params: Record<string, unknown>, log: Logger) {
  const { name, arguments: args = {} } = params;
  if (typeof name !== "string" || !service.tools.some((tool) => tool.name === name)) {
    return { error: invalidParams(`Unknown tool: ${String(name)}`) };
  }
  if (!isObject(args)) return { error: invalidParams("arguments must be an object.") };
  try {
    return { result: service.call(name, args) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("mcp tool call refused", { tool: name, reason: message });
    return { result: { content: [{ type: "text", text: message }], isError: true } };
  }
}

function answer(
  service: Service,
  method: string,
  params: Record<string, unknown>,
  log: Logger,
): { result: unknown } | { error: RpcError } {
  if (method === "initialize") return { result: initialize(service, params) };
  if (method === "ping") return { result: {} };
  if (method === "tools/list") return { result: { tools: service.tools } };
  if (method === "tools/call") return callTool(service, params, log);
  return { error: { code: -32601, message: `Method not found: ${method}` } };
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const message: unknown = JSON.parse(line);
    return isObject(message) ? message : {};
  } catch {
    return undefined;
  }
}

const isId = (id: unknown): id is Id =>
  typeof id === "string" || typeof id === "number" || id === null;

// A notification has no id, and a reply to us has no method: neither is answered.
const needsNoReply = (message: Record<string, unknown>) =>
  !("id" in message) || (!("method" in message) && ("result" in message || "error" in message));

type Request = { id: Id; method: string; params?: Record<string, unknown> };

const isRequest = (message: Record<string, unknown>): message is Request =>
  message.jsonrpc === "2.0" &&
  isId(message.id) &&
  typeof message.method === "string" &&
  (message.params === undefined || isObject(message.params));

// The reply to one line, or nothing for a notification or a client's reply.
function replyTo(service: Service, line: string, log: Logger): Reply | undefined {
  const message = parse(line);
  if (message === undefined) return { jsonrpc: "2.0", id: null, error: parseError };
  if (message.jsonrpc === "2.0" && needsNoReply(message)) return undefined;
  if (!isRequest(message)) {
    return { jsonrpc: "2.0", id: isId(message.id) ? message.id : null, error: invalidRequest };
  }
  const { id, method, params = {} } = message;
  return { jsonrpc: "2.0", id, ...answer(service, method, params, log) };
}

// Serves requests in the order they arrive until the client closes its end.
export async function serveMcp(
  service: Service,
  input: Readable,
  write: (line: string) => void,
  log: Logger,
): Promise<void> {
  log.info("mcp server ready", { server: service.name, tools: service.tools.length });
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim() === "") continue;
    const reply = replyTo(service, line, log);
    if (reply) write(`${JSON.stringify(reply)}\n`);
  }
  log.info("mcp client closed the connection", { server: service.name });
}

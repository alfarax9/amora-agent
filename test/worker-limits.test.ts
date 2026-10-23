import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type ChatRequest, type ChatResponse, GatewayError } from "../src/model-layer/gateway.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { callWorker } from "../src/runtime/worker-runner.ts";

const { items: contracts } = loadContracts(fileURLToPath(new URL("../contracts", import.meta.url)));
const contract = (id: string) => {
  const found = contracts.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`${id} did not load`);
  return found;
};

const answer = (content: string, finish = "stop", completion = 10): ChatResponse => ({
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { prompt_tokens: 10, completion_tokens: completion },
});
const change = JSON.stringify({ summary: "Done.", files: [], notes: [] });

function run(id: string, model: string, chat: (request: ChatRequest) => Promise<ChatResponse>) {
  return callWorker({
    chat,
    model,
    structured: "json_schema",
    prompt: "Work.",
    contract: contract(id),
    input: {},
  });
}

describe("output limits for a worker's call", () => {
  it("gives workers that write code a larger limit and brief thinking, and leaves the others alone", async () => {
    const requests: ChatRequest[] = [];
    await run(
      "code_change.v1",
      "m-code",
      async (request) => (requests.push(request), answer(change)),
    );
    await run("review.v1", "m-review", async (request) => {
      requests.push(request);
      return answer(JSON.stringify({ verdict: "pass", findings: [] }));
    });
    assert.deepEqual(
      requests.map(({ max_tokens, reasoning }) => ({ max_tokens, reasoning })),
      [
        { max_tokens: 64_000, reasoning: { effort: "low" } },
        { max_tokens: 16_000, reasoning: undefined },
      ],
    );
  });

  it("asks again without the reasoning setting when the gateway refuses it, and remembers that", async () => {
    const requests: ChatRequest[] = [];
    const chat = async (request: ChatRequest) => {
      requests.push(request);
      if (request.reasoning)
        throw new GatewayError(404, "No endpoints found that support reasoning");
      return answer(change);
    };
    const first = await run("code_change.v1", "m-plain", chat);
    assert.equal(first.validation, "valid");
    await run("code_change.v1", "m-plain", chat);
    assert.deepEqual(
      requests.map(({ reasoning }) => reasoning?.effort ?? "none"),
      ["low", "none", "none"],
    );
  });

  it("says a reply was cut off at the limit instead of calling it invalid JSON", async () => {
    const result = await run("code_change.v1", "m-long", async () =>
      answer(
        '{"summary": "Done.", "files": [{"path": "src/a.js", "content": "export',
        "length",
        64_000,
      ),
    );
    assert.equal(result.validation, "invalid");
    assert.match(
      result.problems[0] ?? "",
      /^The reply was cut off at the output limit \(64000 tokens\)/,
    );
    assert.match(result.problems[0] ?? "", /Send only the files you change/);
  });

  it("asks for the owner's language and passes on their rules", async () => {
    const requests: ChatRequest[] = [];
    const chat = async (request: ChatRequest) => (requests.push(request), answer(change));
    const call = { chat, structured: "json_schema" as const, prompt: "Work." };
    const worker = { ...call, model: "m-rules", contract: contract("code_change.v1"), input: {} };
    await callWorker(worker);
    await callWorker({ ...worker, rules: "Always answer in Indonesian." });
    const [plain, ruled] = requests.map(({ messages }) => String(messages[0]?.content));
    assert.match(plain ?? "", /in the language the owner wrote the brief in/);
    assert.doesNotMatch(plain ?? "", /owner's rules, which always apply/);
    assert.match(ruled ?? "", /owner's rules, which always apply:\nAlways answer in Indonesian\./);
  });

  it("still passes other errors through", async () => {
    await assert.rejects(
      run("code_change.v1", "m-busy", async () => {
        throw new GatewayError(429, "Rate limit");
      }),
      (error) => error instanceof GatewayError && error.status === 429,
    );
  });
});

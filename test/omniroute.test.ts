import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { omniRouteId, parseModelId } from "../src/model-layer/gateway.ts";
import {
  probedCapabilities,
  saveCombo,
  saveProbeResults,
  staleProbes,
} from "../src/model-layer/known-models.ts";
import { parseComboList, readCombos } from "../src/model-layer/omniroute-combos.ts";
import { contextOf, createOmniRoute, isLocalUrl } from "../src/model-layer/omniroute.ts";
import { assignModel, emptySlots } from "../src/model-layer/slots.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { dayMs } from "../src/runtime/time.ts";

const escape = String.fromCharCode(27);
const cliOutput = `${escape}[2m📋 Loaded env from /Users/x/.omniroute/.env${escape}[0m
{
  "combos": [
    {
      "name": "fara",
      "strategy": "priority",
      "computed_context_length": 131072,
      "models": [
        { "id": "fara-model-1", "kind": "model", "model": "antigravity/gemini-flash" },
        { "id": "fara-model-2", "kind": "model", "model": "antigravity/gpt-oss-120b" }
      ]
    },
    { "name": "nested", "models": [{ "kind": "combo", "model": "fara" }] }
  ]
}`;

function tempStorage() {
  return openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
}

function probe(vision: boolean, structured = "json_schema", context = "0", tools = "true") {
  return [
    { capability: "structured_output" as const, result: structured, detail: "d" },
    { capability: "tool_use" as const, result: tools, detail: "d" },
    { capability: "vision" as const, result: String(vision), detail: "d" },
    { capability: "context" as const, result: context, detail: "d" },
  ];
}

describe("model names per gateway", () => {
  it("reads omniroute: as OmniRoute and a bare id as OpenRouter", () => {
    assert.deepEqual(parseModelId("omniroute:fara"), { gateway: "omniroute", name: "fara" });
    assert.deepEqual(parseModelId("omniroute:antigravity/x"), {
      gateway: "omniroute",
      name: "antigravity/x",
    });
    assert.deepEqual(parseModelId("nvidia/nemotron:free"), {
      gateway: "openrouter",
      name: "nvidia/nemotron:free",
    });
    assert.equal(omniRouteId("fara"), "omniroute:fara");
  });
});

describe("OmniRoute client", () => {
  it("calls the local API with the key and sends no OpenRouter provider preferences", async () => {
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      seen.push({ url, auth: headers.get("Authorization"), body: JSON.parse(String(init.body)) });
      return Response.json({ choices: [{ message: { content: "hi" } }] });
    }) as typeof fetch;
    await createOmniRoute("http://localhost:20128/v1/", "the-key", { fetchImpl: fakeFetch }).chat({
      model: "fara",
      messages: [],
    });
    assert.equal(seen[0]?.url, "http://localhost:20128/v1/chat/completions");
    assert.equal(seen[0]?.auth, "Bearer the-key");
    assert.ok(!("provider" in (seen[0]?.body ?? {})));
  });

  it("gives every request a time limit", async () => {
    let signal: AbortSignal | null | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      signal = init.signal;
      return Response.json({ data: [] });
    }) as typeof fetch;
    await createOmniRoute("http://localhost:20128/v1", "k", { fetchImpl: fakeFetch }).models();
    assert.ok(signal instanceof AbortSignal);
  });

  it("treats a word in an error's code as a retryable upstream failure", async () => {
    const fakeFetch = (async () =>
      Response.json({
        error: { message: "slow down", code: "rate_limit_exceeded" },
      })) as typeof fetch;
    await assert.rejects(
      createOmniRoute("http://localhost:20128/v1", "k", { fetchImpl: fakeFetch }).models(),
      {
        status: 502,
        message: "slow down",
      },
    );
  });

  it("says which address gave no answer in time", async () => {
    const fakeFetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    const client = createOmniRoute("http://localhost:20128/v1", "k", { fetchImpl: fakeFetch });
    await assert.rejects(client.chat({ model: "a/b", messages: [] }), {
      message: "No answer from http://localhost:20128/v1/chat/completions within 120 s.",
    });
  });

  it("says which address stopped answering halfway through its reply", async () => {
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    })) as unknown as typeof fetch;
    const client = createOmniRoute("http://localhost:20128/v1", "k", {
      fetchImpl: fakeFetch,
      timeoutMs: 300_000,
    });
    await assert.rejects(client.chat({ model: "a/b", messages: [] }), {
      message: "No answer from http://localhost:20128/v1/chat/completions within 300 s.",
    });
  });

  it("keeps how long a cooling-down model asks to wait", async () => {
    const fakeFetch = (async () =>
      Response.json(
        { error: { message: "All credentials are cooling down", code: "model_cooldown" } },
        { status: 429, headers: { "Retry-After": "34" } },
      )) as typeof fetch;
    const client = createOmniRoute("http://localhost:20128/v1", "k", { fetchImpl: fakeFetch });
    await assert.rejects(client.chat({ model: "a/b", messages: [] }), {
      status: 429,
      retryAfterMs: 34_000,
    });
  });

  it("reads a context length only when OmniRoute knows it", () => {
    const models = [
      { id: "a", context_length: 200000 },
      { id: "b", context_window: 64000 },
      { id: "c", context_length: null },
    ];
    assert.equal(contextOf(models, "a"), 200000);
    assert.equal(contextOf(models, "b"), 64000);
    assert.equal(contextOf(models, "c"), undefined);
    assert.equal(contextOf(models, "missing"), undefined);
  });

  it("knows which addresses are this machine", () => {
    assert.ok(isLocalUrl("http://localhost:20128/v1"));
    assert.ok(isLocalUrl("http://127.0.0.1:20128/v1"));
    assert.ok(isLocalUrl("http://[::1]:20128/v1"));
    assert.ok(!isLocalUrl("http://192.168.1.20:20128/v1"));
  });
});

describe("combo list", () => {
  it("reads combos past the colour codes and env lines the CLI prints", async () => {
    const combos = await readCombos(async (args) => {
      assert.deepEqual(args, ["combo", "list", "--json"]);
      return cliOutput;
    });
    assert.deepEqual(combos[0], {
      name: "fara",
      strategy: "priority",
      contextLength: 131072,
      members: [
        { model: "antigravity/gemini-flash", kind: "model" },
        { model: "antigravity/gpt-oss-120b", kind: "model" },
      ],
    });
    assert.deepEqual(combos[1]?.members, [{ model: "fara", kind: "combo" }]);
  });

  it("says so when the CLI printed no JSON", () => {
    assert.throws(() => parseComboList("server not running"), /printed no JSON/);
  });
});

describe("combos: every member must meet the worker's requirements", () => {
  const slice = loadManifests(fileURLToPath(new URL("../workers", import.meta.url))).items.find(
    ({ id }) => id === "fe-slice-engineer",
  );
  if (!slice) throw new Error("the example manifest did not load");
  const members = ["omniroute:antigravity/gemini-flash", "omniroute:antigravity/gpt-oss-120b"];
  const record = { members, contextLength: 131072, strategy: "priority" };

  function withCombo(secondHasVision: boolean) {
    const storage = tempStorage();
    saveProbeResults(storage, members[0]!, probe(true));
    saveProbeResults(storage, members[1]!, probe(secondHasVision, "json_mode"));
    saveCombo(storage, "omniroute:fara", record);
    return storage;
  }

  it("can only do what every member can do, with the combo's own context figure", () => {
    const combo = probedCapabilities(withCombo(false), "omniroute:fara")?.capabilities;
    assert.deepEqual(combo, {
      vision: false,
      tool_use: true,
      structured_output: "json_mode",
      context: 131072,
    });
  });

  it("refuses a combo for a worker when one member lacks what the worker needs", () => {
    const storage = withCombo(false);
    const lookup = (model: string) => probedCapabilities(storage, model)?.capabilities;
    const target = { level: "worker" as const, key: slice.id };
    const outcome = assignModel(emptySlots, target, "omniroute:fara", { manifest: slice, lookup });
    assert.ok("problems" in outcome);
    assert.match(
      outcome.problems[0] ?? "",
      /doesn't support vision, but Slice \/ Markup Engineer requires it/,
    );
  });

  it("accepts the combo once every member has what the worker needs", () => {
    const storage = withCombo(true);
    const lookup = (model: string) => probedCapabilities(storage, model)?.capabilities;
    const target = { level: "worker" as const, key: slice.id };
    assert.ok(
      "config" in assignModel(emptySlots, target, "omniroute:fara", { manifest: slice, lookup }),
    );
  });

  it("cannot call tools when a later member cannot, however good the first is", () => {
    const storage = tempStorage();
    saveProbeResults(storage, members[0]!, probe(true, "json_schema", "0", "true"));
    saveProbeResults(storage, members[1]!, probe(true, "json_schema", "0", "false"));
    saveCombo(storage, "omniroute:fara", record);
    assert.equal(probedCapabilities(storage, "omniroute:fara")?.capabilities.tool_use, false);
  });

  it("counts a combo as unknown while any member is unprobed", () => {
    const storage = tempStorage();
    saveProbeResults(storage, members[0]!, probe(true));
    saveCombo(storage, "omniroute:fara", record);
    assert.equal(probedCapabilities(storage, "omniroute:fara"), undefined);
  });

  it("ages with its oldest member", () => {
    const storage = tempStorage();
    const old = new Date("2026-10-01T00:00:00Z");
    saveProbeResults(storage, members[0]!, probe(true), old);
    saveProbeResults(storage, members[1]!, probe(true), new Date(old.getTime() + 6 * dayMs));
    saveCombo(storage, "omniroute:fara", record);
    assert.deepEqual(staleProbes(storage, ["omniroute:fara"], old.getTime() + 8 * dayMs), [
      "omniroute:fara",
    ]);
  });

  it("falls back to the weakest member's context when the gateway gives no figure", () => {
    const storage = tempStorage();
    saveProbeResults(storage, members[0]!, probe(true, "json_schema", "200000"));
    saveProbeResults(storage, members[1]!, probe(true, "json_schema", "64000"));
    saveCombo(storage, "omniroute:fara", { ...record, contextLength: null });
    assert.equal(probedCapabilities(storage, "omniroute:fara")?.capabilities.context, 64000);
  });
});

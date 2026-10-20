import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { agencyFor } from "../src/cli/agency.ts";
import type { AppContext } from "../src/cli/context.ts";
import { checkBudget } from "../src/cli/doctor.ts";
import { priceOf } from "../src/cli/prices.ts";
import { saveCombo } from "../src/model-layer/known-models.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { setup } from "./agency.ts";

describe("CLI: budget and model families", () => {
  const cli = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const home = mkdtempSync(join(tmpdir(), "amora-cli-"));
  const run = (args: string[], env: Record<string, string> = { AMORA_HOME: home }) => {
    try {
      return {
        code: 0,
        out: execFileSync("node", [cli, ...args], {
          env: { ...process.env, ...env },
          encoding: "utf8",
          stdio: "pipe",
        }),
      };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  };

  it("sets and shows the daily limit, and refuses one that is not above 0", () => {
    assert.match(run(["budget"]).out, /No daily limit is set yet/);
    assert.equal(run(["budget", "--daily", "0"]).code, 1);
    assert.match(run(["budget", "--daily", "2.5"]).out, /Daily limit set to \$2.50/);
    assert.match(run(["budget"]).out, /Daily limit \$2.50; spent today \$0.00/);
    assert.match(run(["budget", "--daily", "0.005"]).out, /Daily limit set to \$0.005;/);
    run(["budget", "--daily", "2.5"]);
  });

  it("records a family the registry does not know, and leaves the registry's alone", () => {
    assert.match(
      run(["models", "family", "omniroute:a/claude", "claude"]).out,
      /now in the claude family/,
    );
    assert.equal(run(["models", "family", "omniroute:a/claude", "Claude"]).code, 1);
    assert.match(
      run(["models", "family", "poolside/laguna-xs-2.1:free", "x"]).out,
      /registry already says/,
    );
  });

  it("sets the project folder only to one with a package.json, and names missing scripts", () => {
    assert.match(run(["project"]).out, /No project folder yet/);
    const empty = mkdtempSync(join(tmpdir(), "amora-empty-"));
    assert.equal(run(["project", empty]).code, 1);
    const fixture = fileURLToPath(new URL("fixtures/pricing-site", import.meta.url));
    const set = run(["project", fixture]);
    assert.match(set.out, /New tasks work on .*pricing-site/);
    assert.doesNotMatch(set.out, /has no/);
    assert.match(run(["project"]).out, /New tasks work on .*pricing-site/);
  });

  it("denies OpenRouter data collection until the owner allows it, and says what that means", () => {
    assert.match(
      run(["privacy"]).out,
      /deny providers that keep or train on prompts \(the default\)/,
    );
    const allowed = run(["privacy", "--allow-data-collection"]).out;
    assert.match(allowed, /carry your briefs and your project's files/);
    assert.match(run(["privacy"]).out, /may now serve/);
    assert.match(run(["privacy", "--deny-data-collection"]).out, /\(the default\)/);
  });

  it("records a price AMORA cannot look up, and refuses a negative one", () => {
    assert.match(
      run(["models", "price", "omniroute:a/claude", "0", "0"]).out,
      /costs \$0 in and \$0 out per million tokens/,
    );
    assert.equal(run(["models", "price", "omniroute:a/claude", "-1", "0"]).code, 1);
  });

  it("checks an eval before it calls any model", () => {
    const noModel = run(["eval", "--system", "baseline"]);
    assert.equal(noModel.code, 1);
    assert.match(noModel.out, /Name the baseline's model/);
    const fresh = { AMORA_HOME: mkdtempSync(join(tmpdir(), "amora-cli-")) };
    const noLimit = run(["eval", "--system", "amora"], fresh);
    assert.equal(noLimit.code, 1);
    assert.match(noLimit.out, /AMORA's tasks need a daily limit first/);
    assert.match(run(["eval", "--system", "slim"], fresh).out, /need a daily limit first/);
    for (const runs of ["0", "11", "1.5"]) {
      const refused = run(["eval", "--runs", runs]);
      assert.equal(refused.code, 1);
      assert.match(refused.out, /--runs <n>/);
    }
    run(["budget", "--daily", "1"]);
    for (const system of ["slim,nope", "slim,slim", ""]) {
      assert.match(run(["eval", "--system", system]).out, /--system must be all, both, or/);
    }
    const listed = ["--system", "slim,baseline", "--baseline-model", "fake/x"];
    assert.match(run(["eval", ...listed, "--brief", "nope"]).out, /No brief is named nope/);
    assert.match(run(["eval", ...listed, "--tier", "nope"]).out, /--tier must be all, regression/);
    const heavy = run(["eval", ...listed, "--tier", "heavy", "--brief", "tax"]).out;
    assert.match(heavy, /Briefs: heavy-archive, heavy-dashboard, heavy-habits, heavy-sign-in$/m);
    const realistic = run(["eval", ...listed, "--tier", "realistic", "--brief", "tax"]).out;
    assert.match(
      realistic,
      /No brief is named tax\. Briefs: app-add-note, .*app-states, app-toggle-done$/m,
    );
    const unknown = run(["eval", "--system", "amora", "--brief", "nope"]);
    assert.equal(unknown.code, 1);
    assert.match(
      unknown.out,
      /No brief is named nope\. Briefs: app-add-note, app-date-bug, app-delete-note/,
    );
  });

  it("weighs each new task's brief unless the owner chooses a roster", async () => {
    const fresh = { AMORA_HOME: mkdtempSync(join(tmpdir(), "amora-cli-")) };
    assert.match(run(["roster"], fresh).out, /New tasks are weighed one by one/);
    const { storage } = setup({});
    const context = { storage } as unknown as AppContext;
    const offered = (text: string) => agencyFor(context).roster?.(text).offered;
    const light = "Add a Delete button to each note.";
    const heavy = "Build me a CMS project";
    assert.deepEqual(offered(light), ["fe-engineer", "unit-integration-tester"]);
    assert.equal(offered(heavy), undefined);
    assert.match(agencyFor(context).roster?.(heavy).note ?? "", /heavy task \(a whole product/);
    assert.match(
      run(["roster", "full"], fresh).out,
      /full roster: the Planner may use every worker/,
    );
    storage.setSetting("roster", { profile: "slim" });
    assert.deepEqual(offered(heavy), ["fe-engineer", "unit-integration-tester"]);
    assert.equal(agencyFor(context).roster?.(heavy).note, undefined);
    storage.setSetting("roster", { profile: "full" });
    assert.equal(offered(light), undefined);
    const tiny = run(["roster", "tiny"], fresh);
    assert.equal(tiny.code, 1);
    assert.match(tiny.out, /Choose auto, full, slim\./);
  });

  it("refuses an AMORA_HOME that is set but empty", () => {
    const empty = run(["budget"], { AMORA_HOME: "" });
    assert.equal(empty.code, 1);
    assert.match(empty.out, /AMORA_HOME is set but empty/);
  });
});

describe("doctor: daily limit", () => {
  it("warns until a daily limit is set", () => {
    const { storage } = setup({});
    assert.equal(checkBudget({ storage }).status, "warn");
    storage.setSetting("budgets", { dailyUsd: 2 });
    assert.deepEqual(checkBudget({ storage }), {
      status: "pass",
      label: "Budget",
      detail: "daily limit $2.00",
    });
  });
});

describe("task requests to OpenRouter", () => {
  it("deny data collection unless the owner allowed it for this home (S10)", async (t) => {
    const { storage } = setup({});
    const secrets = memoryStore();
    await secrets.set("openrouter", `sk-or-v1-${"f".repeat(64)}`);
    const sent: { provider?: { data_collection?: string } }[] = [];
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as (typeof sent)[number]);
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    });
    const context = { storage, secrets, manifests: [], contracts: [] } as unknown as AppContext;
    const ask = async () => {
      const { chat, name } = await agencyFor(context).connect("vendor/model:free");
      await chat({ model: name, messages: [] });
    };
    await ask();
    storage.setSetting("privacy", { openRouterDataCollection: "allow" });
    await ask();
    assert.deepEqual(
      sent.map((body) => body.provider?.data_collection),
      ["deny", "allow"],
    );
  });
});

describe("model prices", () => {
  const registry = {
    version: 1,
    models: [{ model: "a/listed", pricing: { per_million: { input: 1, output: 2 } } }],
  };

  async function priced(model: string, stated: Record<string, unknown> = {}) {
    const { storage } = setup({});
    storage.setSetting("prices", stated);
    saveCombo(storage, "omniroute:mix", {
      members: ["omniroute:a/x", "a/listed"],
      contextLength: null,
      strategy: "priority",
    });
    const secrets = memoryStore();
    await secrets.set("openrouter", `sk-or-v1-${"f".repeat(64)}`);
    const context = { storage, secrets, registry } as unknown as AppContext;
    return priceOf(context, model);
  }

  it("takes the owner's price first, then the registry, then OpenRouter's free naming and list", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        data: [{ id: "b/paid", pricing: { prompt: "0.000003", completion: "0.000015" } }],
      }),
    );
    const one = { inputPerMillion: 9, outputPerMillion: 9 };
    assert.deepEqual(await priced("a/listed", { "a/listed": one }), one);
    assert.deepEqual(await priced("a/listed"), { inputPerMillion: 1, outputPerMillion: 2 });
    assert.deepEqual(await priced("c/model:free"), { inputPerMillion: 0, outputPerMillion: 0 });
    const paid = await priced("b/paid");
    assert.ok(
      paid &&
        Math.abs(paid.inputPerMillion - 3) < 1e-9 &&
        Math.abs(paid.outputPerMillion - 15) < 1e-9,
    );
    assert.equal(await priced("b/unknown"), undefined);
  });

  it("never guesses an OmniRoute price, and prices a combo at its dearest member", async () => {
    assert.equal(await priced("omniroute:a/x"), undefined);
    assert.equal(await priced("omniroute:mix"), undefined);
    const stated = { "omniroute:a/x": { inputPerMillion: 0, outputPerMillion: 5 } };
    assert.deepEqual(await priced("omniroute:mix", stated), {
      inputPerMillion: 1,
      outputPerMillion: 5,
    });
  });
});

describe("CLI: starting amora without a browser", { skip: process.platform === "win32" }, () => {
  // A fake `open` (macOS) and `xdg-open` (Linux) that only leave a mark.
  function fakeOpener(): { bin: string; mark: string } {
    const bin = mkdtempSync(join(tmpdir(), "amora-bin-"));
    const mark = join(bin, "opened");
    for (const name of ["open", "xdg-open"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "$@" > "${mark}"\n`, { mode: 0o755 });
    }
    return { bin, mark };
  }

  // The opener runs detached, so a run that should open the browser waits for
  // the mark (a fixed pause fails under load); one that should not waits briefly.
  async function start(args: string[], opener: { bin: string; mark: string }, waitMs: number) {
    const { bin, mark } = opener;
    const main = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
    const child = spawn(
      process.execPath,
      [main, ...args, "--port", String(41000 + Math.floor(Math.random() * 9000))],
      {
        env: {
          ...process.env,
          AMORA_HOME: mkdtempSync(join(tmpdir(), "amora-cli-")),
          PATH: `${bin}:${process.env.PATH}`,
        },
      },
    );
    await new Promise<void>((resolve) => {
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Press Ctrl+C")) resolve();
      });
    });
    for (const deadline = Date.now() + waitMs; Date.now() < deadline && !existsSync(mark);) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    child.kill("SIGINT");
  }

  it("opens the browser by default and not with --no-open", async () => {
    const quiet = fakeOpener();
    await start(["--no-open"], quiet, 500);
    assert.equal(existsSync(quiet.mark), false);
    const loud = fakeOpener();
    await start([], loud, 10_000);
    assert.match(readFileSync(loud.mark, "utf8"), /auth\/sign-in\?token=/);
  });
});

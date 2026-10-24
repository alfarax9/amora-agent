import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The app spec's rule (§13.1): every colour comes from a token. The tokens
// live in dashboard-style.ts's :root block; nothing else in the app's styles
// or scripts may write a colour value of its own.

const raw = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])|\brgba?\(|\bhsla?\(|\boklch\(/i;
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the app's colours", () => {
  it("come only from the tokens in :root", () => {
    const styles = ["dashboard-style.ts", "shell-style.ts", "chat-style.ts"].map((name) => {
      const text = source(`src/runtime/${name}`);
      const root = /:root \{[\s\S]*?\n {2}\}/.exec(text)?.[0] ?? "";
      return [name, text.replace(root, "")] as const;
    });
    const scripts = readdirSync(new URL("../src/dashboard/", import.meta.url))
      .filter((name) => name.endsWith(".js"))
      .map((name) => [name, source(`src/dashboard/${name}`)] as const);
    const offending = [...styles, ...scripts]
      .map(([name, text]) => [name, raw.exec(text)?.[0]] as const)
      .filter(([, found]) => found);
    assert.deepEqual(offending, []);
  });
});

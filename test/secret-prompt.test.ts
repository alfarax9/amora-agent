import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { describe, it } from "node:test";
import { readSecret } from "../src/cli/secret-prompt.ts";

function terminal() {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    modes: boolean[];
  };
  input.isTTY = true;
  input.modes = [];
  input.setRawMode = (mode) => void input.modes.push(mode);
  let shown = "";
  const output = new PassThrough();
  output.on("data", (chunk) => (shown += chunk.toString()));
  return { input, output, shown: () => shown };
}

describe("hidden key prompt", () => {
  it("reads a typed key without echoing it, and handles backspace", async () => {
    const { input, output, shown } = terminal();
    const typed = readSecret("Key: ", input, output);
    input.write("sk-ab\u007fc");
    input.write("d\r");
    assert.equal(await typed, "sk-acd");
    assert.equal(shown(), "Key: \n");
    assert.deepEqual(input.modes, [true, false]);
  });

  it("gives up on Ctrl+C and leaves raw mode", async () => {
    const { input, output } = terminal();
    const typed = readSecret("Key: ", input, output);
    input.write("sk-\u0003");
    await assert.rejects(typed, /Cancelled/);
    assert.deepEqual(input.modes, [true, false]);
  });

  it("reads piped input as is, trimmed", async () => {
    assert.equal(await readSecret("Key: ", Readable.from(["sk-from-a-pipe\n"])), "sk-from-a-pipe");
  });
});

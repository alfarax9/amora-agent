import type { Readable, Writable } from "node:stream";

type Input = Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };

const enter = new Set(["\r", "\n"]);
const backspace = new Set(["\u007f", "\b"]);
const interrupt = "\u0003";

// Reads a secret without echoing it, so it never shows on screen or in
// scrollback. Piped input is read as is, for scripts; a terminal is put in raw
// mode and gets nothing back but a newline at the end.
export function readSecret(
  prompt: string,
  input: Input = process.stdin,
  output: Writable = process.stderr,
): Promise<string> {
  if (!input.isTTY || !input.setRawMode) return readAll(input);
  output.write(prompt);
  const setRawMode = input.setRawMode.bind(input);
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      setRawMode(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === interrupt) return (finish(), reject(new Error("Cancelled.")));
        if (enter.has(character)) return (finish(), resolve(value));
        value = backspace.has(character) ? value.slice(0, -1) : value + character;
      }
    };
    setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readAll(input: Readable): Promise<string> {
  let text = "";
  for await (const chunk of input) text += chunk.toString();
  return text.trim();
}

// CLI output goes through here so the lint rule against console.* can stay on
// for runtime code, where the logger is the only way out.
export function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function printError(line: string): void {
  process.stderr.write(`${line}\n`);
}

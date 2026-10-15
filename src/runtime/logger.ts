import { redactSecrets } from "./secret-scanner.ts";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

export type Logger = Record<Level, (message: string, fields?: Fields) => void>;

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// One JSON line per entry. Every line passes through the secret scanner,
// because a key can reach a log through an error message we do not control.
export function createLogger(
  write: (line: string) => void = (line) => process.stderr.write(line),
  minimum: Level = "info",
): Logger {
  const log =
    (level: Level) =>
    (message: string, fields: Fields = {}) => {
      if (order[level] < order[minimum]) return;
      const entry = { time: new Date().toISOString(), level, message, ...fields };
      write(`${redactSecrets(JSON.stringify(entry))}\n`);
    };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}

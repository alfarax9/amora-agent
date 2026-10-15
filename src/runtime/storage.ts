import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// AMORA_HOME exists so tests and second installs can keep separate state.
export function dataDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.AMORA_HOME ?? join(homedir(), ".amora");
}

// Each entry runs once, in order, and the count of applied entries is the
// schema version. Entries are never edited after release; new ones are added.
const migrations = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE model_probes (
     model TEXT NOT NULL,
     capability TEXT NOT NULL,
     result TEXT NOT NULL,
     detail TEXT NOT NULL,
     probed_at TEXT NOT NULL,
     PRIMARY KEY (model, capability)
   )`,
];

export type Storage = {
  getSetting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): void;
  database: DatabaseSync;
  close(): void;
};

export function openStorage(path: string): Storage {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  migrate(database);
  const read = database.prepare("SELECT value FROM settings WHERE key = ?");
  const write = database.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  return {
    getSetting<T>(key: string) {
      const row = read.get(key) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    setSetting(key, value) {
      write.run(key, JSON.stringify(value));
    },
    database,
    close: () => database.close(),
  };
}

function migrate(database: DatabaseSync): void {
  const { user_version: version } = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (const [index, statement] of migrations.entries()) {
    if (index < version) continue;
    database.exec("BEGIN");
    database.exec(statement);
    database.exec(`PRAGMA user_version = ${index + 1}`);
    database.exec("COMMIT");
  }
}

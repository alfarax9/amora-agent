import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findSecrets } from "./secret-scanner.ts";

// AMORA_HOME exists so tests and second installs can keep separate state. Set
// but empty, it is refused: read as unset it would write to the owner's real
// ~/.amora, and read as a path it would write into the current folder.
export function dataDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.AMORA_HOME;
  if (home === "") throw new Error("AMORA_HOME is set but empty; unset it or give it a folder.");
  return home ?? join(homedir(), ".amora");
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
  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     brief TEXT NOT NULL,
     status TEXT NOT NULL,
     budget_usd REAL NOT NULL,
     spent_usd REAL NOT NULL,
     plan TEXT,
     step INTEGER NOT NULL,
     attempt INTEGER NOT NULL,
     feedback TEXT NOT NULL,
     reason TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE handoffs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT NOT NULL REFERENCES tasks (id),
     sender TEXT NOT NULL,
     receiver TEXT NOT NULL,
     contract TEXT NOT NULL,
     validation TEXT NOT NULL,
     gate TEXT NOT NULL,
     gate_reason TEXT NOT NULL,
     model TEXT NOT NULL,
     answered_by TEXT NOT NULL,
     attempt INTEGER NOT NULL,
     tokens_in INTEGER NOT NULL,
     tokens_out INTEGER NOT NULL,
     cost_usd REAL NOT NULL,
     content TEXT NOT NULL,
     artifacts TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE task_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT NOT NULL REFERENCES tasks (id),
     author TEXT NOT NULL,
     text TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  // The project folder a task works on; workers change a copy of it, and the
  // owner's folder only when they complete the task.
  `ALTER TABLE tasks ADD COLUMN project TEXT`,
  // How often a test run sent the task's work back to an earlier step.
  `ALTER TABLE tasks ADD COLUMN returns INTEGER NOT NULL DEFAULT 0`,
  // Every file a completed task wrote into the owner's project, with the backup
  // of the file it replaced, so the delivery can be undone (deliveries.ts).
  `CREATE TABLE deliveries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT NOT NULL REFERENCES tasks (id),
     project TEXT NOT NULL,
     path TEXT NOT NULL,
     before_hash TEXT,
     after_hash TEXT NOT NULL,
     backup TEXT,
     delivered_at TEXT NOT NULL,
     undone_at TEXT
   )`,
  // When a task paused for a provider's quota resumes by itself, and how many
  // such waits it has had in a row (quota.ts).
  `ALTER TABLE tasks ADD COLUMN resume_at TEXT`,
  `ALTER TABLE tasks ADD COLUMN quota_waits INTEGER NOT NULL DEFAULT 0`,
  // A completed task's branch in a git project (git-delivery.ts).
  `CREATE TABLE branch_deliveries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT NOT NULL REFERENCES tasks (id),
     project TEXT NOT NULL,
     branch TEXT NOT NULL,
     commit_id TEXT NOT NULL,
     delivered_at TEXT NOT NULL,
     undone_at TEXT
   )`,
  // Chat: plain conversations with a model, apart from the code team's tasks
  // (chat-store.ts). Each reply keeps its model, tokens, and cost, which count
  // toward the daily limit like a task's handoffs.
  `CREATE TABLE chats (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     model TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT
   )`,
  `CREATE TABLE chat_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id TEXT NOT NULL REFERENCES chats (id),
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     model TEXT,
     tokens_in INTEGER NOT NULL DEFAULT 0,
     tokens_out INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,
  // The AMORA App's chat (A1). A chat can be starred, and deleting it moves it
  // to the trash until the trash is emptied, which blanks its words; costs stay.
  `ALTER TABLE chats ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE chats ADD COLUMN purged_at TEXT;
   UPDATE chats SET purged_at = deleted_at WHERE deleted_at IS NOT NULL`,
  // Messages form a tree: an edit or a retry adds a sibling, and the chat
  // shows the branch that ends at its leaf. A reply names the worker that
  // answered; a card stands for a task the chat started.
  `ALTER TABLE chat_messages ADD COLUMN parent_id INTEGER REFERENCES chat_messages (id);
   ALTER TABLE chat_messages ADD COLUMN worker TEXT;
   ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'done';
   ALTER TABLE chat_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
   ALTER TABLE chat_messages ADD COLUMN task_id TEXT;
   UPDATE chat_messages SET parent_id = (SELECT MAX(p.id) FROM chat_messages p
     WHERE p.chat_id = chat_messages.chat_id AND p.id < chat_messages.id);
   ALTER TABLE chats ADD COLUMN leaf_id INTEGER;
   UPDATE chats SET leaf_id = (SELECT MAX(id) FROM chat_messages WHERE chat_id = chats.id)`,
  `ALTER TABLE tasks ADD COLUMN chat_id TEXT`,
  // Artifacts: versioned outputs kept outside the message flow.
  `CREATE TABLE artifacts (
     id TEXT PRIMARY KEY,
     chat_id TEXT,
     title TEXT NOT NULL,
     kind TEXT NOT NULL,
     language TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE artifact_versions (
     artifact_id TEXT NOT NULL REFERENCES artifacts (id),
     version INTEGER NOT NULL,
     content TEXT NOT NULL,
     worker TEXT,
     created_at TEXT NOT NULL,
     PRIMARY KEY (artifact_id, version)
   )`,
];

// S6: nothing is written to the database before it has been scanned. Secrets
// belong in the keychain, so a value that looks like one is refused outright
// rather than stored redacted: a redacted copy would still mean a key was on its
// way to disk. The message names the kind, never the value. Tasks, handoffs,
// and chat messages go through this too.
export function refuseSecrets(text: string, where: string): void {
  const [found] = findSecrets(text);
  if (found) {
    throw new Error(
      `Refusing to store a ${found.name} in ${where}. Secrets belong in the keychain.`,
    );
  }
}

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
      const text = JSON.stringify(value);
      refuseSecrets(text, `setting "${key}"`);
      write.run(key, text);
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

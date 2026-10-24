import { randomUUID } from "node:crypto";
import { indexText, unindex } from "./search.ts";
import { refuseSecrets, type Storage } from "./storage.ts";

// Artifacts: versioned outputs, such as a document or a code file, kept
// outside the message flow. Every update is a new version; nothing is
// overwritten. Content passes refuseSecrets like every text AMORA stores.

export type ArtifactKind = "markdown" | "code";

export type ArtifactVersion = {
  version: number;
  content: string;
  worker: string | null;
  createdAt: string;
};

export type Artifact = {
  id: string;
  chatId: string | null;
  title: string;
  kind: ArtifactKind;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  versions: number;
};

type ArtifactRow = {
  id: string;
  chat_id: string | null;
  title: string;
  kind: ArtifactKind;
  language: string | null;
  created_at: string;
  updated_at: string;
  versions: number;
};

const toArtifact = (row: ArtifactRow): Artifact => ({
  id: row.id,
  chatId: row.chat_id,
  title: row.title,
  kind: row.kind,
  language: row.language,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  versions: row.versions,
});

const withCount = `SELECT a.*, (SELECT COUNT(*) FROM artifact_versions v WHERE v.artifact_id = a.id)
  AS versions FROM artifacts a`;

export type NewArtifact = {
  title: string;
  kind: ArtifactKind;
  content: string;
  chatId?: string;
  language?: string;
  worker?: string;
};

export function createArtifact(storage: Storage, made: NewArtifact, now = new Date()): Artifact {
  refuseSecrets(`${made.title}\n${made.content}`, "an artifact");
  const id = randomUUID();
  const at = now.toISOString();
  storage.database
    .prepare(
      `INSERT INTO artifacts (id, chat_id, title, kind, language, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, made.chatId ?? null, made.title, made.kind, made.language ?? null, at, at);
  addVersion(storage, id, made.content, made.worker, now);
  return getArtifact(storage, id) as Artifact;
}

export function addVersion(
  storage: Storage,
  id: string,
  content: string,
  worker?: string,
  now = new Date(),
): number {
  refuseSecrets(content, "an artifact");
  const at = now.toISOString();
  const { next } = storage.database
    .prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM artifact_versions WHERE artifact_id = ?",
    )
    .get(id) as { next: number };
  storage.database
    .prepare(
      `INSERT INTO artifact_versions (artifact_id, version, content, worker, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, next, content, worker ?? null, at);
  storage.database.prepare("UPDATE artifacts SET updated_at = ? WHERE id = ?").run(at, id);
  // Search knows the newest content only.
  const { title } = getArtifact(storage, id) as Artifact;
  unindex(storage, "artifact", id);
  indexText(storage, "artifact", id, { title, body: content });
  return next;
}

export function getArtifact(storage: Storage, id: string): Artifact | undefined {
  const row = storage.database.prepare(`${withCount} WHERE a.id = ?`).get(id);
  return row ? toArtifact(row as ArtifactRow) : undefined;
}

export function artifactVersions(storage: Storage, id: string): ArtifactVersion[] {
  const rows = storage.database
    .prepare(
      `SELECT version, content, worker, created_at FROM artifact_versions
       WHERE artifact_id = ? ORDER BY version`,
    )
    .all(id) as { version: number; content: string; worker: string | null; created_at: string }[];
  return rows.map(({ created_at, ...version }) => ({ ...version, createdAt: created_at }));
}

// Newest first, with the filters the library offers.
export function listArtifacts(
  storage: Storage,
  filter: { kind?: string; chatId?: string } = {},
): Artifact[] {
  const rows = storage.database
    .prepare(
      `${withCount} WHERE (? IS NULL OR a.kind = ?) AND (? IS NULL OR a.chat_id = ?)
       ORDER BY a.updated_at DESC`,
    )
    .all(
      filter.kind ?? null,
      filter.kind ?? null,
      filter.chatId ?? null,
      filter.chatId ?? null,
    ) as ArtifactRow[];
  return rows.map(toArtifact);
}

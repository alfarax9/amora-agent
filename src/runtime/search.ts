import type { Storage } from "./storage.ts";

// Local full-text search over chats, tasks, and artifacts (SQLite FTS5). The
// stores add each text as they store it, so search never sees anything that
// did not pass refuseSecrets. A chat is many rows (its title and each
// message); a hit names the chat once.

export type SearchKind = "chat" | "task" | "artifact";

export type SearchHit = { kind: SearchKind; ref: string; snippet: string };

export function indexText(
  storage: Storage,
  kind: SearchKind,
  ref: string,
  text: { title?: string; body?: string },
): void {
  storage.database
    .prepare("INSERT INTO search_index (kind, ref, title, body) VALUES (?, ?, ?, ?)")
    .run(kind, ref, text.title ?? "", text.body ?? "");
}

export function unindex(storage: Storage, kind: SearchKind, ref: string): void {
  storage.database.prepare("DELETE FROM search_index WHERE kind = ? AND ref = ?").run(kind, ref);
}

// A title changed: the rows that held the old one are replaced.
export function retitle(storage: Storage, kind: SearchKind, ref: string, title: string): void {
  storage.database
    .prepare("DELETE FROM search_index WHERE kind = ? AND ref = ? AND title != ''")
    .run(kind, ref);
  indexText(storage, kind, ref, { title });
}

// Each word as a prefix, quoted, so what the owner types is never read as
// FTS5 syntax.
function matchOf(query: string): string | undefined {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length === 0) return undefined;
  return words.map((word) => `"${word}"*`).join(" ");
}

type HitRow = { kind: SearchKind; ref: string; snippet: string };

// Trashed chats are left out; a chat matched by several messages appears once.
// A snippet marks each match with control characters 2 and 3, which no typed
// text contains, for the page to show in bold (search.js).
export function search(storage: Storage, query: string, limit = 30): SearchHit[] {
  const match = matchOf(query);
  if (!match) return [];
  const rows = storage.database
    .prepare(
      `SELECT kind, ref, snippet(search_index, -1, char(2), char(3), '…', 12) AS snippet
       FROM search_index
       WHERE search_index MATCH ?
         AND NOT (kind = 'chat' AND ref IN (SELECT id FROM chats WHERE deleted_at IS NOT NULL))
       ORDER BY rank LIMIT ?`,
    )
    .all(match, limit * 4) as HitRow[];
  const seen = new Set<string>();
  return rows
    .filter(({ kind, ref }) => !seen.has(`${kind}:${ref}`) && seen.add(`${kind}:${ref}`))
    .slice(0, limit);
}

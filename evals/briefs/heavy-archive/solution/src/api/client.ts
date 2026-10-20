import type { Note } from "../types";

// The notes server's REST API. Every call goes through fetch, so tests can stub it.

export async function listNotes(): Promise<Note[]> {
  const response = await fetch("/api/notes");
  if (!response.ok) throw new Error(`Could not load notes (${response.status}).`);
  return (await response.json()) as Note[];
}

export async function createNote(title: string): Promise<Note> {
  const response = await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return (await response.json()) as Note;
}

async function move(id: number, to: "archive" | "restore"): Promise<Note> {
  const response = await fetch(`/api/notes/${id}/${to}`, { method: "POST" });
  if (!response.ok) throw new Error(`Could not ${to} the note (${response.status}).`);
  return (await response.json()) as Note;
}

export const archiveNote = (id: number) => move(id, "archive");
export const restoreNote = (id: number) => move(id, "restore");

export async function listArchived(): Promise<Note[]> {
  const response = await fetch("/api/notes/archived");
  if (!response.ok) throw new Error(`Could not load the archive (${response.status}).`);
  return (await response.json()) as Note[];
}

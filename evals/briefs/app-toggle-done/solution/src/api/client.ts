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

export async function setNoteDone(id: number, done: boolean): Promise<Note> {
  const response = await fetch(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (!response.ok) throw new Error(`Could not save the note (${response.status}).`);
  return (await response.json()) as Note;
}

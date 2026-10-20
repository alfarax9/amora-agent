import type { Note } from "../types";

// The notes server's REST API. Every call goes through fetch, so tests can stub it.

export async function listNotes(token?: string): Promise<Note[]> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch("/api/notes", { headers });
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

export class WrongCredentials extends Error {}

// The session token, which the caller keeps in memory only.
export async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 401) throw new WrongCredentials("Wrong email or password");
  if (!response.ok) throw new Error(`Could not sign in (${response.status}).`);
  return ((await response.json()) as { token: string }).token;
}

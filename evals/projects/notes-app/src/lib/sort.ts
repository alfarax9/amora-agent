import type { Note } from "../types";

// Newest first, without changing the given array.
export function sortNewestFirst(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

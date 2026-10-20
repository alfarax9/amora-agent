import { useEffect, useState } from "react";
import { deleteNote, listNotes } from "../api/client";
import { formatNoteDate } from "../lib/dates";
import { sortNewestFirst } from "../lib/sort";
import type { Note } from "../types";

export default function NoteList() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listNotes()
      .then((loaded) => {
        if (active) setNotes(sortNewestFirst(loaded));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function remove(note: Note) {
    try {
      await deleteNote(note.id);
      setError(null);
      setNotes((current) => current.filter(({ id }) => id !== note.id));
    } catch {
      setError(`Could not delete "${note.title}". Please try again.`);
    }
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <ul aria-label="Notes">
        {notes.map((note) => (
          <li key={note.id}>
            <span>{note.title}</span>{" "}
            <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>{" "}
            <button
              type="button"
              aria-label={`Delete ${note.title}`}
              onClick={() => void remove(note)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

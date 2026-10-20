import { useEffect, useState } from "react";
import { archiveNote, listNotes } from "../api/client";
import { formatNoteDate } from "../lib/dates";
import { sortNewestFirst } from "../lib/sort";
import type { Note } from "../types";

export default function NoteList() {
  const [notes, setNotes] = useState<Note[]>([]);

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

  async function archive(note: Note) {
    await archiveNote(note.id);
    setNotes((current) => current.filter(({ id }) => id !== note.id));
  }

  return (
    <ul aria-label="Notes">
      {notes.map((note) => (
        <li key={note.id}>
          <span>{note.title}</span>{" "}
          <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>{" "}
          <button
            type="button"
            aria-label={`Archive ${note.title}`}
            onClick={() => void archive(note)}
          >
            Archive
          </button>
        </li>
      ))}
    </ul>
  );
}

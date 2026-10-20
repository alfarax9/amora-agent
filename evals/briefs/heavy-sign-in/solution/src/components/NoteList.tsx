import { useEffect, useState } from "react";
import { listNotes } from "../api/client";
import { formatNoteDate } from "../lib/dates";
import { sortNewestFirst } from "../lib/sort";
import type { Note } from "../types";

export default function NoteList({ token }: { token?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let active = true;
    listNotes(token)
      .then((loaded) => {
        if (active) setNotes(sortNewestFirst(loaded));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <ul aria-label="Notes">
      {notes.map((note) => (
        <li key={note.id}>
          <span>{note.title}</span>{" "}
          <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}

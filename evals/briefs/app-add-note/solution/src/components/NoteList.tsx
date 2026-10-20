import { useEffect, useState } from "react";
import { listNotes } from "../api/client";
import AddNoteForm from "./AddNoteForm";
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

  return (
    <>
      <AddNoteForm onAdded={(note) => setNotes((current) => [note, ...current])} />
      <ul aria-label="Notes">
        {notes.map((note) => (
          <li key={note.id}>
            <span>{note.title}</span>{" "}
            <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
          </li>
        ))}
      </ul>
    </>
  );
}

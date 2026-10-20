import { useEffect, useState } from "react";
import { listNotes } from "../api/client";
import { formatNoteDate } from "../lib/dates";
import { sortNewestFirst } from "../lib/sort";
import type { Note } from "../types";

export default function NoteList() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");

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

  const wanted = query.trim().toLowerCase();
  const shown = notes.filter((note) => note.title.toLowerCase().includes(wanted));

  return (
    <>
      <input
        type="search"
        aria-label="Search notes"
        placeholder="Search notes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul aria-label="Notes">
        {shown.map((note) => (
          <li key={note.id}>
            <span>{note.title}</span>{" "}
            <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
          </li>
        ))}
      </ul>
    </>
  );
}

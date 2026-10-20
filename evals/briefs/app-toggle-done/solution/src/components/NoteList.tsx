import { useEffect, useState } from "react";
import { listNotes, setNoteDone } from "../api/client";
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

  const setDone = (id: number, done: boolean) =>
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, done } : note)));

  async function toggle(note: Note) {
    setDone(note.id, !note.done);
    try {
      await setNoteDone(note.id, !note.done);
    } catch {
      setDone(note.id, note.done);
    }
  }

  return (
    <ul aria-label="Notes">
      {notes.map((note) => (
        <li key={note.id}>
          <label>
            <input type="checkbox" checked={note.done} onChange={() => void toggle(note)} />{" "}
            {note.title}
          </label>{" "}
          <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}

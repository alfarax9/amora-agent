import { useEffect, useState } from "react";
import { listNotes } from "../api/client";
import { sortNewestFirst } from "../lib/sort";
import type { Note } from "../types";
import NoteItem from "./NoteItem";

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

  const replace = (renamed: Note) =>
    setNotes((current) => current.map((note) => (note.id === renamed.id ? renamed : note)));

  return (
    <ul aria-label="Notes">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} onRenamed={replace} />
      ))}
    </ul>
  );
}

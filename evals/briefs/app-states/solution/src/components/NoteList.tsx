import { useEffect, useState } from "react";
import { listNotes } from "../api/client";
import { formatNoteDate } from "../lib/dates";
import { sortNewestFirst } from "../lib/sort";
import type { Note } from "../types";

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; notes: Note[] };

export default function NoteList() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    listNotes()
      .then((loaded) => {
        if (active) setState({ status: "ready", notes: sortNewestFirst(loaded) });
      })
      .catch(() => {
        if (active) setState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") return <p role="status">Loading notes…</p>;
  if (state.status === "failed") {
    return <p role="alert">Could not load your notes. Please try again later.</p>;
  }
  if (state.notes.length === 0) return <p>No notes yet.</p>;
  return (
    <ul aria-label="Notes">
      {state.notes.map((note) => (
        <li key={note.id}>
          <span>{note.title}</span>{" "}
          <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}

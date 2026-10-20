import { useEffect, useState } from "react";
import { listArchived, restoreNote } from "../api/client";
import type { Note } from "../types";

export default function ArchiveView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listArchived()
      .then((loaded) => {
        if (active) setNotes(loaded);
      })
      .catch(() => {
        if (active) setError("Could not load the archive.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function restore(note: Note) {
    try {
      await restoreNote(note.id);
      setNotes((current) => current.filter(({ id }) => id !== note.id));
    } catch {
      setError(`Could not restore "${note.title}".`);
    }
  }

  return (
    <section aria-label="Archive">
      {error && <p role="alert">{error}</p>}
      <ul aria-label="Archived notes">
        {notes.map((note) => (
          <li key={note.id}>
            <span>{note.title}</span>{" "}
            <button
              type="button"
              aria-label={`Restore ${note.title}`}
              onClick={() => void restore(note)}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

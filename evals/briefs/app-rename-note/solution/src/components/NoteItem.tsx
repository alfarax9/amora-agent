import { useState } from "react";
import { renameNote } from "../api/client";
import { formatNoteDate } from "../lib/dates";
import type { Note } from "../types";

export default function NoteItem({
  note,
  onRenamed,
}: {
  note: Note;
  onRenamed: (note: Note) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      return;
    }
    onRenamed(await renameNote(note.id, trimmed));
    setError(null);
    setEditing(false);
  }

  function cancel() {
    setTitle(note.title);
    setError(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <li>
        <label>
          Title <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button type="button" onClick={() => void save()}>
          Save
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        {error && <p role="alert">{error}</p>}
      </li>
    );
  }
  return (
    <li>
      <span>{note.title}</span>{" "}
      <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>{" "}
      <button type="button" aria-label={`Edit ${note.title}`} onClick={() => setEditing(true)}>
        Edit
      </button>
    </li>
  );
}

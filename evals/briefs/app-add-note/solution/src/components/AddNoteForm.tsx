import { type FormEvent, useState } from "react";
import { createNote } from "../api/client";
import type { Note } from "../types";

export default function AddNoteForm({ onAdded }: { onAdded: (note: Note) => void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      return;
    }
    setError(null);
    onAdded(await createNote(trimmed));
    setTitle("");
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>
        Title <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <button type="submit">Add note</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

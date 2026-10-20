import { useState } from "react";
import NoteList from "./components/NoteList";
import ArchiveView from "./components/ArchiveView";

type View = "notes" | "archive";

export default function App() {
  const [view, setView] = useState<View>("notes");
  return (
    <main>
      <h1>Notes</h1>
      <nav aria-label="Main">
        <button type="button" aria-pressed={view === "notes"} onClick={() => setView("notes")}>
          Notes
        </button>
        <button type="button" aria-pressed={view === "archive"} onClick={() => setView("archive")}>
          Archive
        </button>
      </nav>
      {view === "notes" ? <NoteList /> : <ArchiveView />}
    </main>
  );
}

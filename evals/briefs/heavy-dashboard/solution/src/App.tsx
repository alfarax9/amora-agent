import { useState } from "react";
import NoteList from "./components/NoteList";
import Dashboard from "./components/Dashboard";

type View = "notes" | "dashboard";

export default function App() {
  const [view, setView] = useState<View>("notes");
  return (
    <main>
      <h1>Notes</h1>
      <nav aria-label="Main">
        <button type="button" aria-pressed={view === "notes"} onClick={() => setView("notes")}>
          Notes
        </button>
        <button
          type="button"
          aria-pressed={view === "dashboard"}
          onClick={() => setView("dashboard")}
        >
          Dashboard
        </button>
      </nav>
      {view === "notes" ? <NoteList /> : <Dashboard />}
    </main>
  );
}

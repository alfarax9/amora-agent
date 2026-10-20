import { useEffect, useState } from "react";
import { getStats, listNotes, type Stats } from "../api/client";
import type { Note } from "../types";

const newestFirst = (notes: Note[]) =>
  [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [recent, setRecent] = useState<Note[]>([]);

  useEffect(() => {
    let active = true;
    getStats()
      .then((loaded) => {
        if (active) setStats(loaded);
      })
      .catch(() => {
        if (active) setStatsFailed(true);
      });
    listNotes()
      .then((loaded) => {
        if (active) setRecent(newestFirst(loaded).slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-label="Dashboard">
      {statsFailed && <p role="alert">Could not load the stats.</p>}
      {stats && (
        <dl>
          <dt>Total</dt>
          <dd>{stats.total}</dd>
          <dt>Done</dt>
          <dd>{stats.done}</dd>
          <dt>Overdue</dt>
          <dd>{stats.overdue}</dd>
        </dl>
      )}
      <h2>Recent notes</h2>
      <ul aria-label="Recent notes">
        {recent.map((note) => (
          <li key={note.id}>{note.title}</li>
        ))}
      </ul>
    </section>
  );
}

import { type FormEvent, useEffect, useState } from "react";
import { addHabit, checkHabit, listHabits } from "../api/habits";
import type { Habit } from "../types";

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; habits: Habit[] };

export default function HabitTracker() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listHabits()
      .then((habits) => {
        if (active) setState({ status: "ready", habits });
      })
      .catch(() => {
        if (active) setState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, []);

  // Puts the server's copy of a habit in the list, new or updated.
  const keep = (habit: Habit) =>
    setState((current) => {
      if (current.status !== "ready") return current;
      const known = current.habits.some(({ id }) => id === habit.id);
      const habits = known
        ? current.habits.map((other) => (other.id === habit.id ? habit : other))
        : [...current.habits, habit];
      return { ...current, habits };
    });

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setError(null);
    try {
      keep(await addHabit(trimmed));
      setName("");
    } catch {
      setError("Could not add the habit. Please try again.");
    }
  }

  async function check(habit: Habit) {
    try {
      keep(await checkHabit(habit.id));
    } catch {
      setError(`Could not save "${habit.name}". Please try again.`);
    }
  }

  if (state.status === "loading") return <p role="status">Loading habits…</p>;
  if (state.status === "failed") {
    return <p role="alert">Could not load your habits. Please try again later.</p>;
  }
  return (
    <>
      <form onSubmit={(event) => void add(event)}>
        <label>
          Habit name <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">Add habit</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul aria-label="Habits">
        {state.habits.map((habit) => (
          <li key={habit.id}>
            <span>{habit.name}</span>: {habit.streak} {habit.streak === 1 ? "day" : "days"}{" "}
            <button
              type="button"
              aria-label={`Done today: ${habit.name}`}
              onClick={() => void check(habit)}
            >
              Done today
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

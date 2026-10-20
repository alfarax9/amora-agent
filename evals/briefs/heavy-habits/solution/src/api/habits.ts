import type { Habit } from "../types";

// The habits server's REST API. Every call goes through fetch, so tests can stub it.

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`The habits server answered ${response.status}.`);
  return (await response.json()) as T;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const listHabits = () => send<Habit[]>("/api/habits");
export const addHabit = (name: string) => send<Habit>("/api/habits", post({ name }));
export const checkHabit = (id: number) => send<Habit>(`/api/habits/${id}/check`, post());

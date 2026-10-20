import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { errorShown, fakeApi, loadingShown } from "./fake-api";
import { note } from "./notes-server";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const habits = [
  { id: 1, name: "Read", streak: 3 },
  { id: 2, name: "Run", streak: 0 },
];

function serve(extra?: (call: { method: string; path: string }) => Response | undefined) {
  return fakeApi((call) => {
    const answer = extra?.(call);
    if (answer) return answer;
    if (call.method === "GET" && call.path === "/api/habits") return Response.json(habits);
    return undefined;
  });
}

// The habit's name is shown with its streak, in the same element or right next to it.
function streakShown(name: string, streak: number): boolean {
  const pattern = new RegExp(`(?<!\\d)${streak}[- ]?days?\\b`, "i");
  return screen
    .queryAllByText(new RegExp(`^\\s*${name}\\b`))
    .some((element) =>
      [element, element.parentElement, element.nextElementSibling].some((near) =>
        pattern.test(near?.textContent ?? ""),
      ),
    );
}

describe("habit tracker", () => {
  it("says the habits are loading until they arrive", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<App />);
    expect(loadingShown(document)).toBe(true);
  });

  it("shows each habit with its streak", async () => {
    serve();
    render(<App />);
    await waitFor(() => expect(streakShown("Read", 3)).toBe(true));
    expect(streakShown("Run", 0)).toBe(true);
    expect(loadingShown(document)).toBe(false);
  });

  it("adds a habit, and refuses a blank name", async () => {
    const calls = serve((call) =>
      call.method === "POST" && call.path === "/api/habits"
        ? Response.json({ id: 3, name: "Meditate", streak: 0 }, { status: 201 })
        : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(streakShown("Read", 3)).toBe(true));
    await user.click(screen.getByRole("button", { name: /add habit/i }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(calls.filter(({ method }) => method === "POST")).toEqual([]);
    await user.type(screen.getByLabelText(/habit name/i), "Meditate");
    await user.click(screen.getByRole("button", { name: /add habit/i }));
    await waitFor(() => expect(streakShown("Meditate", 0)).toBe(true));
    expect(calls.find(({ method }) => method === "POST")).toMatchObject({
      path: "/api/habits",
      body: { name: "Meditate" },
    });
  });

  it("checks a habit off for today and shows its new streak", async () => {
    const calls = serve((call) =>
      call.method === "POST" && call.path === "/api/habits/1/check"
        ? Response.json({ id: 1, name: "Read", streak: 4 })
        : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /done today: read/i }));
    await waitFor(() => expect(streakShown("Read", 4)).toBe(true));
    expect(calls.some(({ path }) => path === "/api/habits/1/check")).toBe(true);
  });

  it("says when the habits cannot be loaded", async () => {
    serve(() => new Response("down", { status: 500 }));
    render(<App />);
    await waitFor(() => expect(errorShown(document)).toBe(true));
    expect(loadingShown(document)).toBe(false);
  });
});

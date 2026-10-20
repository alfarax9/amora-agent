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

// Seven notes, created on Oct 1 to Oct 7, in no particular order.
const notes = [3, 7, 1, 5, 2, 6, 4].map((day) =>
  note(day, `Note ${day}`, { createdAt: `2026-10-0${day}T08:00:00Z` }),
);

function serve(stats: Response = Response.json({ total: 7, done: 3, overdue: 1 })) {
  return fakeApi((call) => {
    if (call.method === "GET" && call.path === "/api/notes") return Response.json(notes);
    if (call.method === "GET" && call.path === "/api/stats") return stats.clone();
    return undefined;
  });
}

// The one number shown in a label's element or right next to it.
function numberNear(label: string): string | undefined {
  const labels = screen.queryAllByText(new RegExp(`^\\s*${label}\\b`, "i")).reverse();
  for (const element of labels) {
    const near = [
      element,
      element.nextElementSibling,
      element.previousElementSibling,
      element.parentElement,
    ];
    for (const candidate of near) {
      const numbers = candidate?.textContent?.match(/\d+/g) ?? [];
      if (numbers.length === 1) return numbers[0];
    }
  }
  return undefined;
}

const titlesShown = () =>
  screen.queryAllByText(/^\s*Note \d\s*$/).map((element) => element.textContent?.trim());

describe("the dashboard", () => {
  it("shows the stats with their labels", async () => {
    serve();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() =>
      expect(["Total", "Done", "Overdue"].map(numberNear)).toEqual(["7", "3", "1"]),
    );
  });

  it("lists the five newest notes, newest first", async () => {
    serve();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() =>
      expect(titlesShown()).toEqual(["Note 7", "Note 6", "Note 5", "Note 4", "Note 3"]),
    );
  });

  it("keeps the recent notes when the stats cannot be loaded", async () => {
    serve(new Response("down", { status: 500 }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() => expect(errorShown(document)).toBe(true));
    await waitFor(() => expect(titlesShown()).toContain("Note 7"));
  });

  it("switches back to the notes list", async () => {
    serve();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() => expect(titlesShown()).toHaveLength(5));
    await user.click(screen.getByRole("button", { name: "Notes" }));
    await waitFor(() => expect(titlesShown()).toHaveLength(7));
  });
});

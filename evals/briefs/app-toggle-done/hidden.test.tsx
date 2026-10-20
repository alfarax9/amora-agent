import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { fakeServer, note } from "./notes-server";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("marking notes done", () => {
  it("shows each note's state and saves a change", async () => {
    const calls = fakeServer([note(1, "Buy milk"), note(2, "Call Ana", { done: true })], (call) =>
      call.method === "PATCH" ? Response.json(note(1, "Buy milk", { done: true })) : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    const box = await screen.findByRole("checkbox", { name: /buy milk/i });
    expect(box).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /call ana/i })).toBeChecked();
    await user.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(calls.find(({ method }) => method === "PATCH")).toMatchObject({
      path: "/api/notes/1",
      body: { done: true },
    });
  });

  it("puts the checkbox back when saving fails", async () => {
    const calls = fakeServer([note(1, "Buy milk")], (call) =>
      call.method === "PATCH" ? new Response("no", { status: 500 }) : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    const box = await screen.findByRole("checkbox", { name: /buy milk/i });
    await user.click(box);
    await waitFor(() => expect(calls.some(({ method }) => method === "PATCH")).toBe(true));
    await waitFor(() => expect(box).not.toBeChecked());
  });
});

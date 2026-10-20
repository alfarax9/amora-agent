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

const saved = (title: string) => Response.json(note(9, title), { status: 201 });

describe("adding a note", () => {
  it("saves the title, shows the new note, and clears the field", async () => {
    const calls = fakeServer([note(1, "Call Ana")], (call) =>
      call.method === "POST" ? saved("Buy milk") : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Call Ana");
    const field = screen.getByLabelText(/title/i);
    await user.type(field, "Buy milk");
    await user.click(screen.getByRole("button", { name: /add note/i }));
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(calls.find(({ method }) => method === "POST")).toMatchObject({
      path: "/api/notes",
      body: { title: "Buy milk" },
    });
    expect(field).toHaveValue("");
    expect(screen.getByText("Call Ana")).toBeInTheDocument();
  });

  it("refuses an empty or blank title and sends nothing", async () => {
    const calls = fakeServer([]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /add note/i }));
    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/title/i), "   ");
    await user.click(screen.getByRole("button", { name: /add note/i }));
    expect(screen.getByText("Title is required")).toBeInTheDocument();
    expect(calls.filter(({ method }) => method === "POST")).toEqual([]);
  });
});

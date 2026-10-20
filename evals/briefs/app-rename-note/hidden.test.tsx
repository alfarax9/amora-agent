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

describe("renaming a note", () => {
  it("saves the new title and shows it", async () => {
    const calls = fakeServer([note(1, "Buy milk")], (call) =>
      call.method === "PUT" ? Response.json(note(1, "Buy oat milk")) : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /edit buy milk/i }));
    const field = screen.getByLabelText(/title/i);
    expect(field).toHaveValue("Buy milk");
    await user.clear(field);
    await user.type(field, "Buy oat milk");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Buy oat milk")).toBeInTheDocument();
    expect(calls.find(({ method }) => method === "PUT")).toMatchObject({
      path: "/api/notes/1",
      body: { title: "Buy oat milk" },
    });
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
  });

  it("refuses a blank title and sends nothing", async () => {
    const calls = fakeServer([note(1, "Buy milk")]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /edit buy milk/i }));
    await user.clear(screen.getByLabelText(/title/i));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(calls.filter(({ method }) => method === "PUT")).toEqual([]);
  });

  it("puts the old title back on Cancel without saving", async () => {
    const calls = fakeServer([note(1, "Buy milk")]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /edit buy milk/i }));
    await user.type(screen.getByLabelText(/title/i), " later");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
    expect(calls.filter(({ method }) => method === "PUT")).toEqual([]);
  });
});

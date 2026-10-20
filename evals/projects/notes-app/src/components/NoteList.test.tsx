import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NoteList from "./NoteList";

describe("NoteList", () => {
  it("shows every note the server returns", async () => {
    const notes = [
      { id: 1, title: "Buy milk", done: false, createdAt: "2026-10-01T08:00:00Z" },
      { id: 2, title: "Call Ana", done: true, createdAt: "2026-10-02T08:00:00Z" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(notes)),
    );
    render(<NoteList />);
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("Call Ana")).toBeInTheDocument();
  });
});

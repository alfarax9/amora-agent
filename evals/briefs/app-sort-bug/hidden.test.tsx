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

describe("note order", () => {
  it("shows the newest note first", async () => {
    fakeServer([
      note(1, "Middle", { createdAt: "2026-10-02T08:00:00Z" }),
      note(2, "Newest", { createdAt: "2026-10-05T08:00:00Z" }),
      note(3, "Oldest", { createdAt: "2026-10-01T08:00:00Z" }),
    ]);
    render(<App />);
    await screen.findByText("Newest");
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.match(/Newest|Middle|Oldest/)?.[0])).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });
});

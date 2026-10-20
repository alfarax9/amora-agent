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

describe("note dates", () => {
  it("shows the day each note was created", async () => {
    fakeServer([
      note(1, "Buy milk", { createdAt: "2026-10-05T09:30:00Z" }),
      note(2, "Call Ana", { createdAt: "2026-01-31T12:00:00Z" }),
    ]);
    render(<App />);
    expect(await screen.findByText("Oct 5, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jan 31, 2026")).toBeInTheDocument();
  });
});

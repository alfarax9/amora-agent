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

const loadingShown = () =>
  screen.queryAllByText(/loading/i).length > 0 ||
  screen.queryAllByRole("progressbar").length > 0 ||
  document.querySelector('[aria-busy="true"]') !== null;

describe("list states", () => {
  it("says the notes are loading until they arrive", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<App />);
    expect(loadingShown()).toBe(true);
  });

  it("says when there are no notes", async () => {
    fakeServer([]);
    render(<App />);
    await waitFor(() =>
      expect(document.body).toHaveTextContent(
        /no notes|nothing here|no .*notes yet|empty|haven.t (added|created)|add your first|create your first/i,
      ),
    );
    expect(loadingShown()).toBe(false);
  });

  it("says when the notes could not be loaded", async () => {
    fakeServer([], () => new Response("down", { status: 500 }));
    render(<App />);
    await waitFor(() => {
      const alerted = screen.queryAllByRole("alert").some((alert) => alert.textContent?.trim());
      const said = /error|fail|could ?n.t|unable|went wrong|try again|problem/i.test(
        document.body.textContent ?? "",
      );
      expect(alerted || said).toBe(true);
    });
    expect(loadingShown()).toBe(false);
  });

  it("shows the notes, and no loading message, once they arrive", async () => {
    fakeServer([note(1, "Buy milk")]);
    render(<App />);
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(loadingShown()).toBe(false);
  });
});

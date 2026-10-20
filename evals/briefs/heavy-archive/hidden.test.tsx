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

function serve() {
  return fakeApi((call) => {
    if (call.method === "GET" && call.path === "/api/notes") {
      return Response.json([note(1, "Buy milk"), note(2, "Call Ana")]);
    }
    if (call.method === "GET" && call.path === "/api/notes/archived") {
      return Response.json([note(5, "Old idea")]);
    }
    const moved = call.path.match(/^\/api\/notes\/(\d+)\/(archive|restore)$/);
    if (call.method === "POST" && moved) return Response.json(note(Number(moved[1]), "Moved"));
    return undefined;
  });
}

describe("archiving notes", () => {
  it("archives a note from the list", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /archive buy milk/i }));
    await waitFor(() => expect(screen.queryByText("Buy milk")).not.toBeInTheDocument());
    expect(screen.getByText("Call Ana")).toBeInTheDocument();
    expect(
      calls.some(({ method, path }) => method === "POST" && path === "/api/notes/1/archive"),
    ).toBe(true);
  });

  it("shows the archive on its own screen and restores a note from it", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Buy milk");
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Old idea")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /restore old idea/i }));
    await waitFor(() => expect(screen.queryByText("Old idea")).not.toBeInTheDocument());
    expect(
      calls.some(({ method, path }) => method === "POST" && path === "/api/notes/5/restore"),
    ).toBe(true);
  });

  it("switches back to the notes", async () => {
    serve();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Buy milk");
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByText("Old idea");
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
  });
});

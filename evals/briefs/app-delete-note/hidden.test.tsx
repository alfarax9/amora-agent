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

describe("deleting a note", () => {
  it("deletes it on the server and removes it from the list", async () => {
    const calls = fakeServer([note(1, "Buy milk"), note(2, "Call Ana")], (call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /delete buy milk/i }));
    await waitFor(() => expect(screen.queryByText("Buy milk")).not.toBeInTheDocument());
    expect(screen.getByText("Call Ana")).toBeInTheDocument();
    expect(calls.find(({ method }) => method === "DELETE")).toMatchObject({ path: "/api/notes/1" });
  });

  it("keeps the note and says so when the server refuses", async () => {
    fakeServer([note(1, "Buy milk")], (call) =>
      call.method === "DELETE" ? new Response("no", { status: 500 }) : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /delete buy milk/i }));
    await waitFor(() => {
      const alerted = screen.queryAllByRole("alert").some((alert) => alert.textContent?.trim());
      const said = /error|fail|could ?n.t|unable|went wrong|try again|problem/i.test(
        document.body.textContent ?? "",
      );
      expect(alerted || said).toBe(true);
    });
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });
});

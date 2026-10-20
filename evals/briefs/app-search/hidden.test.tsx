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

describe("narrowing the list", () => {
  it("shows only the notes whose title contains the typed text, and all of them again when cleared", async () => {
    fakeServer([note(1, "Buy milk"), note(2, "Call Ana"), note(3, "Oat milk latte")]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Call Ana");
    const field = screen.queryByRole("searchbox") ?? screen.getByRole("textbox");
    await user.type(field, "milk");
    await waitFor(() => expect(screen.queryByText("Call Ana")).not.toBeInTheDocument());
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("Oat milk latte")).toBeInTheDocument();
    await user.clear(field);
    expect(await screen.findByText("Call Ana")).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });
});

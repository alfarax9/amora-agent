import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  it("shows its heading and loads the habits", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<App />);
    expect(screen.getByRole("heading", { name: "Habits" })).toBeInTheDocument();
    expect(screen.getByText(/loading habits/i)).toBeInTheDocument();
  });
});

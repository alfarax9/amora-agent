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

// The page's text without the notes themselves, so a note's date or title
// cannot pass for the summary. Pieces are joined with spaces: textContent
// would run "Notes" and "2 left" together into "Notes2 left".
function summary(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("li").forEach((item) => item.remove());
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  while (walker.nextNode()) pieces.push(walker.currentNode.textContent ?? "");
  return pieces.join(" ");
}

const left = /left|to ?do|remaining|open|pending|unfinished|not done|outstanding|incomplete/i;

describe("the to-do summary", () => {
  it("counts the notes that are not done", async () => {
    fakeServer([note(1, "Buy milk"), note(3, "Call Ana", { done: true }), note(4, "Pay rent")]);
    render(<App />);
    await screen.findByText("Pay rent");
    await waitFor(() => {
      expect(summary()).toMatch(/\b2\b/);
      expect(summary()).toMatch(left);
    });
  });

  it("says when nothing is left", async () => {
    fakeServer([note(1, "Buy milk", { done: true }), note(3, "Call Ana", { done: true })]);
    render(<App />);
    await screen.findByText("Call Ana");
    await waitFor(() =>
      expect(summary()).toMatch(
        /\b0\b|\bno\b.*\b(left|to ?do|remaining|open|pending)|nothing (left|to do)|all (done|caught up|finished|complete)/i,
      ),
    );
  });
});

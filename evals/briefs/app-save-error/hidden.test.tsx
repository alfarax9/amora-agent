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

import { createNote } from "../api/client";

describe("createNote", () => {
  it("fails when the server refuses the note", async () => {
    for (const status of [400, 500]) {
      fakeServer([], () => Response.json({ error: "no" }, { status }));
      await expect(createNote("Buy milk")).rejects.toThrow();
    }
  });

  it("returns the saved note when the server accepts it", async () => {
    fakeServer([], () => Response.json(note(9, "Buy milk"), { status: 201 }));
    await expect(createNote("Buy milk")).resolves.toMatchObject({ id: 9, title: "Buy milk" });
  });
});

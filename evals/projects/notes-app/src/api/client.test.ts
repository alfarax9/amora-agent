import { describe, expect, it, vi } from "vitest";
import { listNotes } from "./client";

describe("listNotes", () => {
  it("fails when the server answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    await expect(listNotes()).rejects.toThrow("Could not load notes (500).");
  });
});

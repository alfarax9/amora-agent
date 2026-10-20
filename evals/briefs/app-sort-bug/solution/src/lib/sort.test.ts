import { describe, expect, it } from "vitest";
import { sortNewestFirst } from "./sort";

describe("sortNewestFirst", () => {
  it("puts the most recent note first", () => {
    const older = { id: 1, title: "a", done: false, createdAt: "2026-10-01T08:00:00Z" };
    const newer = { id: 2, title: "b", done: false, createdAt: "2026-10-02T08:00:00Z" };
    expect(sortNewestFirst([older, newer]).map(({ id }) => id)).toEqual([2, 1]);
  });
});

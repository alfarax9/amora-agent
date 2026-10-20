import { describe, expect, it } from "vitest";
import { formatNoteDate } from "./dates";

describe("formatNoteDate", () => {
  it("shows the day of the month, not the day of the week", () => {
    expect(formatNoteDate("2026-10-05T09:30:00Z")).toBe("Oct 5, 2026");
  });
});

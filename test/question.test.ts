import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isQuestion } from "../src/runtime/question.ts";

describe("questions", () => {
  it("tells a question from a request for work, in English and Indonesian", () => {
    const questions = [
      "what is modeling ai ??",
      "Why does the login page reload?",
      "How do I add a page?",
      "apa itu agent harness",
      "kenapa tombol login tidak jalan?",
    ];
    const work = [
      "Add a pricing section to the landing page.",
      "Can you add a dark mode toggle?",
      "tolong perbaiki tombol login",
      "buatkan halaman login",
      "test",
    ];
    assert.deepEqual(questions.filter(isQuestion), questions);
    assert.deepEqual(work.filter(isQuestion), []);
  });
});

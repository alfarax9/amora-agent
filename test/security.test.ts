import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "../src/runtime/logger.ts";
import { findSecrets, maskSecret, redactSecrets } from "../src/runtime/secret-scanner.ts";
import {
  createSessions,
  readCookie,
  rejectForeignRequest,
  sessionCookie,
} from "../src/runtime/security.ts";

const openRouterKey = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;

describe("secret scanner", () => {
  it("finds an OpenRouter key once, not again as an OpenAI key", () => {
    const matches = findSecrets(`my key is ${openRouterKey} thanks`);
    assert.deepEqual(matches, [{ name: "OpenRouter key", index: 10 }]);
  });

  it("finds keys from several providers", () => {
    const text = [
      `sk-ant-${"x".repeat(30)}`,
      `sk-proj-${"y".repeat(40)}`,
      `AIza${"z".repeat(35)}`,
      `ghp_${"q".repeat(36)}`,
      "AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN RSA PRIVATE KEY-----",
    ].join(" ");
    assert.equal(findSecrets(text).length, 6);
  });

  it("leaves ordinary prose and code alone", () => {
    const text = "Build a pricing page with sk-style classes and a 12:30 meeting.";
    assert.deepEqual(findSecrets(text), []);
    assert.equal(redactSecrets(text), text);
  });

  it("redacts keys with their kind", () => {
    assert.equal(redactSecrets(`key=${openRouterKey}`), "key=[redacted OpenRouter key]");
  });

  it("masks to the last four characters, and hides short values entirely", () => {
    assert.equal(maskSecret(openRouterKey), "••••c3d4");
    assert.equal(maskSecret("short"), "••••");
  });

  it("redacts secrets in log lines", () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).error("call failed", {
      error: `401 for ${openRouterKey}`,
    });
    assert.ok(lines[0]?.includes("[redacted OpenRouter key]"));
    assert.ok(!lines[0]?.includes(openRouterKey));
  });
});

describe("request checks", () => {
  it("accepts 127.0.0.1 and localhost on the runtime's port", () => {
    assert.equal(rejectForeignRequest({ host: "127.0.0.1:4310" }, 4310), undefined);
    assert.equal(
      rejectForeignRequest({ host: "localhost:4310", origin: "http://localhost:4310" }, 4310),
      undefined,
    );
  });

  it("refuses rebinding hosts, other ports, and cross-site origins", () => {
    assert.ok(rejectForeignRequest({ host: "evil.example:4310" }, 4310));
    assert.ok(rejectForeignRequest({ host: "127.0.0.1:4311" }, 4310));
    assert.ok(rejectForeignRequest({}, 4310));
    assert.ok(
      rejectForeignRequest({ host: "127.0.0.1:4310", origin: "https://evil.example" }, 4310),
    );
    assert.ok(rejectForeignRequest({ host: "127.0.0.1:4310", origin: "null" }, 4310));
  });
});

describe("sessions", () => {
  it("spends a sign-in token on first use", () => {
    const sessions = createSessions();
    const token = sessions.issueSignInToken();
    const sessionId = sessions.exchange(token);
    assert.ok(sessionId);
    assert.ok(sessions.isValid(sessionId));
    assert.equal(sessions.exchange(token), undefined);
  });

  it("refuses an expired sign-in token and unknown sessions", () => {
    let now = 0;
    const sessions = createSessions(() => now);
    const token = sessions.issueSignInToken();
    now = 5 * 60 * 1000 + 1;
    assert.equal(sessions.exchange(token), undefined);
    assert.equal(sessions.isValid("made-up"), false);
    assert.equal(sessions.isValid(undefined), false);
  });

  it("sets an HttpOnly, SameSite=Strict cookie named for the port", () => {
    assert.equal(
      sessionCookie(4310, "abc"),
      "amora_session_4310=abc; HttpOnly; SameSite=Strict; Path=/",
    );
    assert.equal(readCookie("a=1; amora_session_4310=abc; b=2", "amora_session_4310"), "abc");
    assert.equal(readCookie(undefined, "amora_session_4310"), undefined);
  });
});

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { errorShown, fakeApi, loadingShown } from "./fake-api";
import { note } from "./notes-server";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function serve() {
  return fakeApi((call) => {
    if (call.method === "POST" && call.path === "/api/session") {
      const { email, password } = (call.body ?? {}) as { email?: string; password?: string };
      return email === "ana@example.com" && password === "secret"
        ? Response.json({ token: "t-123" })
        : Response.json({ error: "no" }, { status: 401 });
    }
    if (call.method === "GET" && call.path === "/api/notes") {
      return call.headers.authorization === "Bearer t-123"
        ? Response.json([note(1, "Buy milk")])
        : new Response("no", { status: 401 });
    }
    return undefined;
  });
}

async function signIn(password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), "ana@example.com");
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole("button", { name: /sign in/i }));
  return user;
}

describe("signing in", () => {
  it("asks to sign in before loading any notes", () => {
    const calls = serve();
    render(<App />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(calls.some(({ path }) => path === "/api/notes")).toBe(false);
  });

  it("refuses a wrong password", async () => {
    serve();
    render(<App />);
    await signIn("wrong");
    expect(await screen.findByText("Wrong email or password")).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("loads the notes with the token, and keeps the token out of storage", async () => {
    const calls = serve();
    render(<App />);
    await signIn("secret");
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(calls.find(({ path }) => path === "/api/session")).toMatchObject({
      method: "POST",
      body: { email: "ana@example.com", password: "secret" },
    });
    expect([localStorage.length, sessionStorage.length, document.cookie]).toEqual([0, 0, ""]);
  });

  it("signs out back to the sign-in screen", async () => {
    serve();
    render(<App />);
    const user = await signIn("secret");
    await screen.findByText("Buy milk");
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });
});

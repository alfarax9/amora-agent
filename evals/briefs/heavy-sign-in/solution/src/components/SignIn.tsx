import { type FormEvent, useState } from "react";
import { signIn, WrongCredentials } from "../api/client";

export default function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onSignedIn(await signIn(email, password));
    } catch (failure) {
      setError(
        failure instanceof WrongCredentials ? "Wrong email or password" : "Could not sign in.",
      );
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>
        Email{" "}
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password{" "}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit">Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

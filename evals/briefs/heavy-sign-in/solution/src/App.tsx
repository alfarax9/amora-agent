import { useState } from "react";
import NoteList from "./components/NoteList";
import SignIn from "./components/SignIn";

export default function App() {
  // In memory only: a reload signs the user out.
  const [token, setToken] = useState<string | null>(null);
  return (
    <main>
      <h1>Notes</h1>
      {token ? (
        <>
          <button type="button" onClick={() => setToken(null)}>
            Sign out
          </button>
          <NoteList token={token} />
        </>
      ) : (
        <SignIn onSignedIn={setToken} />
      )}
    </main>
  );
}

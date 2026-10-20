export function createStore() {
  return { notes: [], nextId: 1 };
}

const notFound = { status: 404, body: { error: "Not found" } };

export function handle(store, request) {
  const [path, query = ""] = request.path.split("?");
  const params = new URLSearchParams(query);
  if (request.method === "GET" && path === "/notes" && params.has("done")) {
    const done = params.get("done");
    if (done !== "true" && done !== "false") {
      return { status: 400, body: { error: "done must be true or false" } };
    }
    return { status: 200, body: store.notes.filter((note) => note.done === (done === "true")) };
  }
  if (request.method === "GET" && request.path === "/notes") {
    return { status: 200, body: store.notes };
  }
  if (request.method === "POST" && request.path === "/notes") {
    const note = { id: store.nextId, title: request.body.title, done: false };
    store.nextId += 1;
    store.notes.push(note);
    return { status: 201, body: note };
  }
  return notFound;
}

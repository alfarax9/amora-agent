// A small notes service: an in-memory store and a request handler, so it can
// be tested without a server. A request is { method, path, body }; a response
// is { status, body }.
export function createStore() {
  return { notes: [], nextId: 1 };
}

export function handle(store, request) {
  if (request.method === "GET" && request.path === "/notes") {
    return { status: 200, body: store.notes };
  }
  if (request.method === "POST" && request.path === "/notes") {
    const note = { id: store.nextId, title: request.body.title, done: false };
    store.nextId += 1;
    store.notes.push(note);
    return { status: 201, body: note };
  }
  return { status: 404, body: { error: "Not found" } };
}

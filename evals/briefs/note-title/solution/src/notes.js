export function createStore() {
  return { notes: [], nextId: 1 };
}

const notFound = { status: 404, body: { error: "Not found" } };

export function handle(store, request) {
  if (request.method === "POST" && request.path === "/notes") {
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    if (!title) return { status: 400, body: { error: "Title is required" } };
    request = { ...request, body: { ...request.body, title } };
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

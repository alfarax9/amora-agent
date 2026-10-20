export function createStore() {
  return { notes: [], nextId: 1 };
}

const notFound = { status: 404, body: { error: "Not found" } };

export function handle(store, request) {
  const [path, query = ""] = request.path.split("?");
  const params = new URLSearchParams(query);
  if (request.method === "GET" && path === "/notes" && params.has("limit")) {
    const limit = Number(params.get("limit"));
    if (!/^\d+$/.test(params.get("limit") ?? "") || limit < 1 || limit > 100) {
      return { status: 400, body: { error: "limit must be 1 to 100" } };
    }
    return { status: 200, body: store.notes.slice(0, limit) };
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

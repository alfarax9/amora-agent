export function createStore() {
  return { notes: [], nextId: 1 };
}

const notFound = { status: 404, body: { error: "Not found" } };

export function handle(store, request) {
  const match = request.path.match(/^\/notes\/(\d+)(\/done)?$/);
  const note = match ? store.notes.find(({ id }) => id === Number(match[1])) : undefined;
  if (request.method === "DELETE" && match && !match[2]) {
    if (!note) return notFound;
    store.notes = store.notes.filter((other) => other !== note);
    return { status: 204, body: null };
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

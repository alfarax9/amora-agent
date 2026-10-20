export function createStore() {
  return { notes: [], nextId: 1 };
}

const notFound = { status: 404, body: { error: "Not found" } };

export function handle(store, request) {
  if (request.method === "GET" && request.path === "/notes/stats") {
    const done = store.notes.filter((note) => note.done).length;
    return {
      status: 200,
      body: { total: store.notes.length, done, open: store.notes.length - done },
    };
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

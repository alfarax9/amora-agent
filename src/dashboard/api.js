// The runtime's API, as every page calls it. A refusal carries the runtime's
// own words and the HTTP status, so a caller can tell a refusal from a
// feature the runtime lacks.

export async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Can't reach the AMORA runtime. Run amora in a terminal, then reload this page.",
    );
  }
  const reply = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = reply.error ?? "The runtime could not do that. Check its log.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return reply;
}

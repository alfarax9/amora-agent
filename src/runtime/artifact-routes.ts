import type { IncomingMessage } from "node:http";
import {
  addVersion,
  type ArtifactKind,
  artifactVersions,
  createArtifact,
  getArtifact,
  listArtifacts,
} from "./artifact-store.ts";
import { search } from "./search.ts";
import type { Storage } from "./storage.ts";
import { BadRequest, type JsonReply, readJson, refuseKeys } from "./task-routes.ts";

// Artifacts and search for the app: the artifact library, one artifact with
// its versions, saving a reply or a code block as an artifact, a new version,
// and local full-text search. Behind the session and Origin checks like every
// API route.

const kinds: ArtifactKind[] = ["markdown", "code"];

const textOf = (value: unknown, limit: number, missing: string): string => {
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) throw new BadRequest(400, missing);
  if (text.length > limit) throw new BadRequest(413, "That is too long to keep as an artifact.");
  return refuseKeys(text);
};

function one(storage: Storage, id: string): JsonReply {
  const artifact = getArtifact(storage, id);
  if (!artifact) throw new BadRequest(404, "There is no such artifact.");
  return { status: 200, body: { artifact, versions: artifactVersions(storage, id) } };
}

function create(storage: Storage, body: Record<string, unknown>): JsonReply {
  const kind = kinds.find((known) => known === body.kind) ?? "markdown";
  const made = createArtifact(storage, {
    title: textOf(body.title, 200, "Give the artifact a title."),
    kind,
    content: textOf(body.content, 1_000_000, "An artifact needs content."),
    ...(typeof body.chatId === "string" ? { chatId: body.chatId } : {}),
    ...(typeof body.language === "string" && body.language ? { language: body.language } : {}),
    ...(typeof body.worker === "string" ? { worker: body.worker } : {}),
  });
  return { ...one(storage, made.id), status: 201 };
}

async function post(storage: Storage, request: IncomingMessage, path: string) {
  const body = await readJson(request);
  if (path === "/api/artifacts") return create(storage, body);
  const [, id = ""] = /^\/api\/artifacts\/([0-9a-f-]{36})\/versions$/.exec(path) ?? [];
  if (!id || !getArtifact(storage, id)) return undefined;
  addVersion(storage, id, textOf(body.content, 1_000_000, "A version needs content."));
  return one(storage, id);
}

function get(storage: Storage, url: URL): JsonReply | undefined {
  const { pathname, searchParams } = url;
  if (pathname === "/api/search") {
    return { status: 200, body: { hits: search(storage, searchParams.get("q") ?? "") } };
  }
  if (pathname === "/api/artifacts") {
    const kind = searchParams.get("kind");
    const chatId = searchParams.get("chat");
    const filter = { ...(kind ? { kind } : {}), ...(chatId ? { chatId } : {}) };
    return { status: 200, body: { artifacts: listArtifacts(storage, filter) } };
  }
  const [, id = ""] = /^\/api\/artifacts\/([0-9a-f-]{36})$/.exec(pathname) ?? [];
  return id ? one(storage, id) : undefined;
}

// Answers an artifact or search request, or nothing when the path is not one.
export async function handleArtifactApi(
  storage: Storage,
  request: IncomingMessage,
  url: URL,
): Promise<JsonReply | undefined> {
  try {
    if (request.method === "GET") return get(storage, url);
    return request.method === "POST" ? await post(storage, request, url.pathname) : undefined;
  } catch (error) {
    if (error instanceof BadRequest)
      return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

import type { IncomingMessage } from "node:http";
import type { Chosen } from "./folder-dialog.ts";
import {
  addProject,
  chooseProject,
  currentProject,
  inspectProject,
  listProjects,
  ProjectError,
  removeProject,
} from "./projects.ts";
import { deliveryMode } from "./ship.ts";
import type { Storage } from "./storage.ts";
import { BadRequest, type JsonReply, readJson } from "./task-routes.ts";

// The projects new tasks can work on, for the composer's project picker:
// list them with what each lacks, add one from the system's folder dialog,
// choose one, and take one off the list. Behind
// the session and Origin checks like every API route.

export type ProjectDesk = { storage: Storage; chooseFolder: () => Promise<Chosen> };

function projects(storage: Storage): JsonReply {
  const current = currentProject(storage);
  const checks = listProjects(storage).map((project) => inspectProject(project, current));
  return { status: 200, body: { projects: checks, delivery: deliveryMode({ storage }) } };
}

const textOf = (value: unknown) => (typeof value === "string" ? value : undefined);

const changes: Record<string, (storage: Storage, folder: string, name?: string) => unknown> = {
  "/api/projects": addProject,
  "/api/projects/current": chooseProject,
  "/api/projects/remove": removeProject,
};

async function post(storage: Storage, request: IncomingMessage, path: string) {
  const body = await readJson(request);
  const folder = textOf(body.path);
  if (!folder) throw new BadRequest(400, "Name the project's folder.");
  changes[path]?.(storage, folder, textOf(body.name));
  return { ...projects(storage), status: path === "/api/projects" ? 201 : 200 };
}

// The folder the owner picks in the system's dialog becomes a project at
// once; a folder that cannot be one says why, with its path.
async function pickFolder(desk: ProjectDesk): Promise<JsonReply> {
  const chosen = await desk.chooseFolder();
  if ("unavailable" in chosen) return { status: 501, body: { error: chosen.unavailable } };
  if ("cancelled" in chosen) return { status: 200, body: { cancelled: true } };
  try {
    addProject(desk.storage, chosen.path);
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    return { status: 400, body: { error: error.message, path: chosen.path } };
  }
  return { ...projects(desk.storage), status: 201 };
}

async function answer(desk: ProjectDesk, request: IncomingMessage, url: URL) {
  const { pathname } = url;
  const { storage } = desk;
  if (request.method === "GET" && pathname === "/api/projects") return projects(storage);
  if (request.method !== "POST") return undefined;
  if (pathname === "/api/folders/choose") return pickFolder(desk);
  return pathname in changes ? post(storage, request, pathname) : undefined;
}

// Answers a project request, or nothing when the path is not one of these.
export async function handleProjectApi(
  desk: ProjectDesk,
  request: IncomingMessage,
  url: URL,
): Promise<JsonReply | undefined> {
  try {
    return await answer(desk, request, url);
  } catch (error) {
    if (error instanceof BadRequest)
      return { status: error.status, body: { error: error.message } };
    if (error instanceof ProjectError) return { status: 400, body: { error: error.message } };
    throw error;
  }
}

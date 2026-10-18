import { readFileSync } from "node:fs";

// The dashboard's scripts, read once at start. Only these names are served,
// so a path in a request can never reach another file.
const files: Record<string, URL> = {
  "/dashboard/app.js": new URL("../dashboard/app.js", import.meta.url),
  "/dashboard/render.js": new URL("../dashboard/render.js", import.meta.url),
  "/dashboard/log.js": new URL("../dashboard/log.js", import.meta.url),
  "/dashboard/dom.js": new URL("../dashboard/dom.js", import.meta.url),
};

const cache = new Map<string, string>();

export function dashboardScript(path: string): string | undefined {
  const file = files[path];
  if (!file) return undefined;
  const cached = cache.get(path) ?? readFileSync(file, "utf8");
  cache.set(path, cached);
  return cached;
}

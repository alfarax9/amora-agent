import { readFileSync } from "node:fs";

// The dashboard's scripts and division mascots, read once and kept. Only these
// names are served, so a path in a request can never reach another file.

const scripts = [
  "api.js",
  "app.js",
  "chat.js",
  "costs.js",
  "dom.js",
  "highlight.js",
  "log.js",
  "markdown.js",
  "models.js",
  "overview.js",
  "panel.js",
  "projects.js",
  "render.js",
  "reports.js",
  "review.js",
  "router.js",
  "settings.js",
  "setup.js",
  "sidebar.js",
  "status.js",
  "tasks.js",
  "topbar.js",
  "workers.js",
];

// The divisions' pixel mascots, from the AMORA website.
const divisions = [
  "atelier",
  "atlas",
  "bastion",
  "bridge",
  "compass",
  "crucible",
  "forge",
  "harbor",
  "ledger",
  "lens",
  "lyceum",
  "nexus",
];

type Served = { file: URL; type: string };

const files = new Map<string, Served>([
  ...scripts.map((name): [string, Served] => [
    `/dashboard/${name}`,
    {
      file: new URL(`../dashboard/${name}`, import.meta.url),
      type: "text/javascript; charset=utf-8",
    },
  ]),
  ...divisions.map((name): [string, Served] => [
    `/dashboard/mascots/${name}.svg`,
    { file: new URL(`../dashboard/mascots/${name}.svg`, import.meta.url), type: "image/svg+xml" },
  ]),
]);

const cache = new Map<string, string>();

export function dashboardFile(path: string): { body: string; type: string } | undefined {
  const served = files.get(path);
  if (!served) return undefined;
  const body = cache.get(path) ?? readFileSync(served.file, "utf8");
  cache.set(path, body);
  return { body, type: served.type };
}

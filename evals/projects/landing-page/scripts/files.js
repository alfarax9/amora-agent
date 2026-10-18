import { readdirSync } from "node:fs";
import { join } from "node:path";

// Every JavaScript file under a folder, for the lint and syntax checks.
export function javascriptFiles(folder) {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(folder, name));
}

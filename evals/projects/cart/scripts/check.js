import { spawnSync } from "node:child_process";
import { javascriptFiles } from "./files.js";

// The fixture's typecheck: every source file must at least parse.
let failed = false;
for (const file of javascriptFiles("src")) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr);
  }
}
process.exit(failed ? 1 : 0);

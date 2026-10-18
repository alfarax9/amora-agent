import { readFileSync } from "node:fs";
import { javascriptFiles } from "./files.js";

// The fixture's lint: no var declarations and no console.log in source files.
const rules = [
  [/\bvar\s/, "use let or const instead of var"],
  [/console\.log/, "remove console.log"],
];
let problems = 0;
for (const file of javascriptFiles("src")) {
  for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
    for (const [pattern, message] of rules) {
      if (pattern.test(line)) {
        problems += 1;
        process.stderr.write(`${file}:${index + 1} ${message}\n`);
      }
    }
  }
}
process.exit(problems > 0 ? 1 : 0);

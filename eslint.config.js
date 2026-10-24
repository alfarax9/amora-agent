import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// The limits come from the product spec's clean code rules (PRD §15).
export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 4],
      complexity: ["error", 10],
    },
  },
  {
    // Test files group many cases inside one describe block.
    files: ["test/**/*.ts"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    // The dashboard's scripts run in the browser, not in Node.
    files: ["src/dashboard/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        Event: "readonly",
      },
    },
  },
  // Separate projects that tests and the benchmark run tasks against, with their
  // own checks, and the benchmark's hidden tests.
  globalIgnores(["node_modules/**", "test/fixtures/**", "evals/**"]),
]);

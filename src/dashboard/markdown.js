import { el } from "./dom.js";
import { highlight } from "./highlight.js";

// The Markdown a reply uses, turned into elements made from text nodes only,
// so nothing a model writes can run as HTML: paragraphs, headings, lists,
// quotes, tables, fenced code with its language, Copy, and Save as artifact,
// and inline code, bold, italic, and links (http and https only, opened in a
// new tab).

const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g;

function inlineNode(token) {
  if (token.startsWith("`")) return el("code", {}, token.slice(1, -1));
  if (token.startsWith("**")) return el("strong", {}, ...inline(token.slice(2, -2)));
  if (token.startsWith("[")) {
    const [, label = "", href = ""] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
    if (!/^https?:\/\//i.test(href)) return label;
    return el("a", { href, target: "_blank", rel: "noopener noreferrer" }, label);
  }
  return el("em", {}, ...inline(token.slice(1, -1)));
}

function inline(text) {
  return text.split(inlinePattern).map((part, index) => (index % 2 ? inlineNode(part) : part));
}

// A paragraph keeps its line breaks, as a chat reply means them.
function paragraph(lines) {
  const children = lines.flatMap((line, index) =>
    index ? [el("br"), ...inline(line)] : inline(line),
  );
  return el("p", {}, ...children);
}

const listItem = /^\s*(?:[-*•]|\d+[.)])\s+/;

function list(lines) {
  const ordered = /^\s*\d+[.)]\s/.test(lines[0] ?? "");
  const items = lines.map((line) => el("li", {}, ...inline(line.replace(listItem, ""))));
  return el(ordered ? "ol" : "ul", {}, items);
}

function heading(line) {
  const [, marks = "#", text = ""] = /^(#{1,6})\s+(.*)$/.exec(line) ?? [];
  return el(marks.length <= 2 ? "h3" : "h4", {}, ...inline(text));
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

// A table scrolls in its own container, so a wide one never widens the page.
function table(lines) {
  const [head = "", , ...rows] = lines;
  const separator = /^\s*\|?\s*:?-{2,}/.test(lines[1] ?? "");
  const body = separator ? rows : lines.slice(1);
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          cells(head).map((cell) => el("th", {}, ...inline(cell))),
        ),
      ),
      el(
        "tbody",
        {},
        body.map((row) =>
          el(
            "tr",
            {},
            cells(row).map((cell) => el("td", {}, ...inline(cell))),
          ),
        ),
      ),
    ),
  );
}

// Lines of the same kind make one block; a blank line ends a block.
function kindOf(line) {
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (/^\s*\|.*\|\s*$/.test(line)) return "table";
  if (listItem.test(line)) return "list";
  if (/^>\s?/.test(line)) return "quote";
  return "text";
}

function block(kind, lines) {
  if (kind === "heading") return lines.map(heading);
  if (kind === "list") return [list(lines)];
  if (kind === "table") return [table(lines)];
  if (kind === "quote")
    return [el("blockquote", {}, paragraph(lines.map((l) => l.replace(/^>\s?/, ""))))];
  return [paragraph(lines)];
}

function prose(text) {
  const nodes = [];
  let kind = null;
  let lines = [];
  const flush = () => (lines.length && nodes.push(...block(kind, lines)), (lines = []));
  for (const line of text.split("\n")) {
    if (line.trim() === "") flush();
    else {
      if (kindOf(line) !== kind) flush();
      kind = kindOf(line);
      lines.push(line);
    }
  }
  flush();
  return nodes;
}

function codeBlock(code, language, onSave) {
  const copy = el("button", { type: "button", class: "ghost" }, "Copy");
  copy.addEventListener("click", async () => {
    await globalThis.navigator.clipboard.writeText(code);
    copy.textContent = "Copied";
  });
  const save = onSave
    ? el(
        "button",
        { type: "button", class: "ghost", onclick: () => onSave(code, language) },
        "Save as artifact",
      )
    : null;
  return el(
    "figure",
    { class: "code-block" },
    el("figcaption", {}, el("span", { class: "lang" }, language || "code"), copy, save),
    el("pre", { class: "code" }, el("code", {}, ...highlight(code, language))),
  );
}

// Fenced code first: inside a fence nothing is Markdown. An open fence, as in
// a reply still streaming, runs to the end. `onSave(code, language)` offers
// Save as artifact on each code block.
export function markdown(text, { onSave } = {}) {
  const parts = text.split(/^```[^\n]*\n?/m);
  // Fences open and close in turn; code part 2k + 1 follows fence 2k.
  const fences = [...text.matchAll(/^```([^\n]*)\n?/gm)].map(([, language]) => language.trim());
  return parts.flatMap((part, index) =>
    index % 2 ? [codeBlock(part.replace(/\n$/, ""), fences[index - 1], onSave)] : prose(part),
  );
}

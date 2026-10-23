import { el } from "./dom.js";

// The Markdown a chat reply uses, turned into elements made from text nodes
// only, so nothing a model writes can run as HTML: paragraphs, headings,
// lists, quotes, fenced code, and inline code, bold, italic, and links (http
// and https only, opened in a new tab).

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

// Lines of the same kind make one block; a blank line ends a block.
function kindOf(line) {
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (listItem.test(line)) return "list";
  if (/^>\s?/.test(line)) return "quote";
  return "text";
}

function block(kind, lines) {
  if (kind === "heading") return lines.map(heading);
  if (kind === "list") return [list(lines)];
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

// Fenced code first: inside a fence nothing is Markdown. An open fence, as
// in a reply still streaming, runs to the end.
export function markdown(text) {
  const parts = text.split(/^```[^\n]*\n?/m);
  return parts.flatMap((part, index) =>
    index % 2
      ? [el("pre", { class: "code" }, el("code", {}, part.replace(/\n$/, "")))]
      : prose(part),
  );
}

import { el } from "./dom.js";

// Syntax colours for code in replies, without a library: comments, strings,
// numbers, and keywords for the languages replies use most. Anything not
// recognised stays plain text; nothing here runs or parses the code.

const keywords = {
  js: "as async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof interface let new null of return static super switch this throw true try type typeof undefined var void while yield",
  sh: "case do done elif else esac export fi for function if in local return then until while",
  css: "important",
  html: "",
  json: "false null true",
  py: "and as async await break class continue def del elif else except False finally for from if import in is lambda None not or pass raise return True try while with yield",
};

const families = {
  javascript: "js",
  js: "js",
  jsx: "js",
  ts: "js",
  tsx: "js",
  typescript: "js",
  json: "json",
  sh: "sh",
  bash: "sh",
  shell: "sh",
  zsh: "sh",
  css: "css",
  html: "html",
  xml: "html",
  py: "py",
  python: "py",
};

const comments = { js: "//[^\\n]*|/\\*[\\s\\S]*?\\*/", sh: "#[^\\n]*", py: "#[^\\n]*" };
comments.css = "/\\*[\\s\\S]*?\\*/";
comments.html = "<!--[\\s\\S]*?-->";

function patternOf(family) {
  const words = keywords[family].split(" ").filter(Boolean).join("|");
  const parts = [
    comments[family] ? `(${comments[family]})` : "()",
    "(\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)",
    "(\\b\\d+(?:\\.\\d+)?\\b)",
    words ? `(\\b(?:${words})\\b)` : "()",
  ];
  return new RegExp(parts.join("|"), "g");
}

const classes = ["tok-comment", "tok-string", "tok-number", "tok-keyword"];

export function highlight(code, language) {
  const family = families[(language ?? "").toLowerCase()];
  if (!family) return [code];
  const nodes = [];
  let last = 0;
  for (const match of code.matchAll(patternOf(family))) {
    const group = match.slice(1).findIndex((part) => part);
    if (group < 0 || match[0] === "") continue;
    nodes.push(code.slice(last, match.index), el("span", { class: classes[group] }, match[0]));
    last = match.index + match[0].length;
  }
  nodes.push(code.slice(last));
  return nodes.filter((node) => node !== "");
}

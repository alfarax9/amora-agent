import { call } from "./api.js";
import { el } from "./dom.js";

// Search over chats, sessions, and artifacts, from the sidebar or Mod+K: a
// dialog that searches as the owner types, groups what it finds, and moves
// between results with the arrow keys. The runtime marks each match in a
// snippet with control characters 2 and 3 (search.ts), shown here in bold.

const dialog = document.getElementById("search-dialog");
const groups = [
  ["chat", "Chats", (ref) => `/chat/${ref}`],
  ["task", "Sessions", (ref) => `/code/${ref}`],
  ["artifact", "Artifacts", (ref) => `/artifacts?open=${ref}`],
];
let typed = 0;

const opens = String.fromCharCode(2);
const closes = String.fromCharCode(3);

function snippet(text) {
  return text.split(opens).flatMap((part, index) => {
    if (index === 0) return [part];
    const [marked = "", rest = ""] = part.split(closes);
    return [el("mark", {}, marked), rest];
  });
}

function results(hits) {
  if (hits.length === 0) return [el("p", { class: "meta" }, "Nothing found.")];
  return groups.flatMap(([kind, name, path]) => {
    const found = hits.filter((hit) => hit.kind === kind);
    if (found.length === 0) return [];
    const links = found.map((hit) =>
      el(
        "a",
        { class: "search-hit", href: path(hit.ref) },
        el("span", { class: "search-title" }, hit.title || "Untitled"),
        el("span", { class: "meta" }, ...snippet(hit.snippet)),
      ),
    );
    return [el("p", { class: "group-title" }, name), ...links];
  });
}

async function find(query, list) {
  const turn = ++typed;
  if (!query.trim()) return list.replaceChildren();
  try {
    const { hits } = await call("GET", `/api/search?q=${encodeURIComponent(query)}`);
    if (turn === typed) list.replaceChildren(...results(hits));
  } catch (error) {
    list.replaceChildren(el("p", { class: "error" }, error.message));
  }
}

// Up and Down move between results; the input stays where typing goes.
function move(event, input, list) {
  const links = [...list.querySelectorAll("a")];
  if (!["ArrowDown", "ArrowUp"].includes(event.key) || links.length === 0) return;
  event.preventDefault();
  const at = links.indexOf(document.activeElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = at + step;
  if (next < 0) return input.focus();
  links[Math.min(next, links.length - 1)].focus();
}

export function openSearch() {
  const input = el("input", {
    id: "search-input",
    type: "search",
    placeholder: "Search chats, sessions, and artifacts",
    "aria-label": "Search",
    autocomplete: "off",
  });
  const list = el("div", { class: "picker-list search-results", role: "list" });
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void find(input.value, list), 150);
  });
  dialog.replaceChildren(el("h2", { id: "search-title" }, "Search"), input, list);
  dialog.onkeydown = (event) => move(event, input, list);
  if (!dialog.open) dialog.showModal();
  input.focus();
}

export function initSearch() {
  document.getElementById("open-search").addEventListener("click", openSearch);
  // A result followed, or a click on the backdrop, closes the dialog.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("a")) dialog.close();
  });
}

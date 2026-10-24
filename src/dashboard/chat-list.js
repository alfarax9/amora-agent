import { call } from "./api.js";
import { button, el } from "./dom.js";
import { go } from "./router.js";

// Chat's side of the sidebar: starred chats, then recent ones grouped by day,
// each with a menu to star, rename, export, or delete it, and the trash,
// where a deleted chat can be restored until the trash is emptied.

const $ = (id) => document.getElementById(id);
const dayMs = 86_400_000;

function dayOf(updatedAt, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const at = Date.parse(updatedAt);
  if (at >= today.getTime()) return "Today";
  if (at >= today.getTime() - dayMs) return "Yesterday";
  return at >= today.getTime() - 7 * dayMs ? "Previous 7 days" : "Older";
}

function download(filename, content) {
  const link = el("a", { href: URL.createObjectURL(new Blob([content])), download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function exportChat(id, format = "markdown") {
  const { filename, content } = await call("GET", `/api/chats/${id}/export?format=${format}`);
  download(filename, content);
}

// Each change answers with the chat list, which `changed` redraws.
async function change(chat, action, body, changed) {
  const reply = await call("POST", `/api/chats/${chat.id}/${action}`, body);
  changed(reply);
}

export async function renameChat(chat, changed) {
  const title = globalThis.prompt("Rename the chat", chat.title);
  if (title?.trim()) await change(chat, "rename", { title }, changed);
}

export async function deleteChat(chat, changed, current) {
  await change(chat, "delete", {}, changed);
  if (current) go("/");
}

function menu(chat, changed, current) {
  const actions = [
    [
      chat.starred ? "Unstar" : "Star",
      () => change(chat, "star", { starred: !chat.starred }, changed),
    ],
    ["Rename", () => renameChat(chat, changed)],
    ["Export as Markdown", () => exportChat(chat.id)],
    ["Export as JSON", () => exportChat(chat.id, "json")],
    ["Delete", () => deleteChat(chat, changed, current)],
  ];
  const list = el(
    "div",
    { class: "row-menu", role: "menu" },
    actions.map(([label, run]) =>
      el("button", { type: "button", role: "menuitem", onclick: () => void run() }, label),
    ),
  );
  return el(
    "details",
    { class: "row-actions" },
    el("summary", { "aria-label": `More for ${chat.title}`, title: "More" }, "⋯"),
    list,
  );
}

function row(chat, selected, changed) {
  const current = chat.id === selected;
  return el(
    "div",
    { class: "chat-row" },
    el(
      "a",
      {
        class: "task-link",
        href: `/chat/${chat.id}`,
        title: chat.title,
        "aria-current": current ? "page" : undefined,
      },
      chat.title,
    ),
    menu(chat, changed, current),
  );
}

function trashButton(trash, changed) {
  if (!trash?.length) return null;
  return el(
    "button",
    { type: "button", class: "ghost trash-link", onclick: () => openTrash(trash, changed) },
    `Trash (${trash.length})`,
  );
}

export function renderChatList({ chats, trash }, selected, changed) {
  return chatRows(chats, selected, changed).concat(trashButton(trash, changed) ?? []);
}

function chatRows(chats, selected, changed) {
  if (chats.length === 0) {
    return [
      el("p", { class: "meta task-link" }, "No chats yet. Ask the agency something to start."),
    ];
  }
  const starred = chats.filter((chat) => chat.starred);
  const groups = new Map(starred.length ? [["Starred", starred]] : []);
  for (const chat of chats.filter((one) => !one.starred)) {
    const day = dayOf(chat.updatedAt);
    groups.set(day, [...(groups.get(day) ?? []), chat]);
  }
  return [
    ...[...groups].flatMap(([name, group]) => [
      el("p", { class: "group-title" }, name),
      ...group.map((chat) => row(chat, selected, changed)),
    ]),
  ];
}

function trashRows(trash, restore) {
  return trash.map((chat) =>
    el(
      "div",
      { class: "picker-row" },
      el("span", { class: "picker-item" }, chat.title || "Untitled"),
      button("Restore", () => void restore(chat.id), "secondary"),
    ),
  );
}

function openTrash(trash, changed) {
  const dialog = $("search-dialog");
  const restore = async (id) => {
    changed(await call("POST", `/api/chats/${id}/restore`));
    dialog.close();
    go(`/chat/${id}`);
  };
  const empty = async () => {
    const sure = globalThis.confirm(
      "Empty the trash? The words go for good; what they cost stays in today's spend.",
    );
    if (!sure) return;
    changed(await call("POST", "/api/chats/trash/empty"));
    dialog.close();
  };
  dialog.replaceChildren(
    el("h2", { id: "search-title" }, "Trash"),
    el("div", { class: "picker-list" }, trashRows(trash, restore)),
    el(
      "div",
      { class: "actions" },
      button("Empty trash", () => void empty(), "secondary danger"),
    ),
  );
  dialog.showModal();
}

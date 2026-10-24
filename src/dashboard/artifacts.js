import { call } from "./api.js";
import { button, el } from "./dom.js";
import { highlight } from "./highlight.js";
import { markdown } from "./markdown.js";

// Artifacts (app spec §8.8): versioned outputs kept beside the conversation.
// One opens in the side panel with its versions, a preview or its source,
// Copy, Download, and a comparison with the version before; /artifacts lists
// them all. Markdown and code only in A1: pages and components need their
// own sandboxed origin first.

const $ = (id) => document.getElementById(id);
const panel = $("panel");
const view = { id: null, version: null, mode: "preview" };

function stored(key, value) {
  try {
    if (value === undefined) return globalThis.localStorage.getItem(key);
    globalThis.localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return value;
}

// A line diff by longest common subsequence; artifacts are small enough.
function commonLengths(a, b) {
  const common = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i][j] =
        a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  return common;
}

function lineDiff(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const common = commonLengths(a, b);
  const lines = [];
  let i = 0;
  let j = 0;
  const addNext = () => j < b.length && (i === a.length || common[i][j + 1] >= common[i + 1][j]);
  while (i < a.length || j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      lines.push(["same", a[i]]);
      i += 1;
      j += 1;
    } else if (addNext()) lines.push(["add", b[j++]]);
    else lines.push(["del", a[i++]]);
  }
  return lines;
}

function body(artifact, versions, shown) {
  if (view.mode === "compare") {
    const before = versions.find(({ version }) => version === shown.version - 1)?.content ?? "";
    const marks = { same: " ", add: "+", del: "−" };
    return el(
      "pre",
      { class: "diff" },
      lineDiff(before, shown.content).map(([kind, line]) =>
        el("span", { class: kind }, `${marks[kind]} ${line}\n`),
      ),
    );
  }
  if (artifact.kind === "markdown" && view.mode === "preview")
    return el("div", { class: "prose" }, markdown(shown.content));
  return el(
    "pre",
    { class: "code" },
    el("code", {}, ...highlight(shown.content, artifact.language)),
  );
}

function download(artifact, shown) {
  const extension = artifact.kind === "markdown" ? "md" : artifact.language || "txt";
  const link = el("a", {
    href: URL.createObjectURL(new Blob([shown.content])),
    download: `${artifact.title}.${extension}`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function versionSelect(artifact, versions, shown) {
  const options = versions.map(({ version }) =>
    el(
      "option",
      { value: version, selected: version === shown.version ? "" : undefined },
      `Version ${version}`,
    ),
  );
  const select = el("select", { "aria-label": "Version" }, options);
  select.addEventListener("change", () => {
    view.version = Number(select.value);
    draw(artifact, versions);
  });
  return select;
}

function toolbar(artifact, versions, shown) {
  const mode = (name, label) =>
    button(label, () => ((view.mode = name), draw(artifact, versions)), "tab", {
      "aria-selected": String(view.mode === name),
    });
  return el(
    "div",
    { class: "artifact-tools" },
    versionSelect(artifact, versions, shown),
    artifact.kind === "markdown" ? mode("preview", "Preview") : null,
    mode("code", "Code"),
    shown.version > 1 ? mode("compare", "Compare") : null,
    button("Copy", () => void globalThis.navigator.clipboard.writeText(shown.content)),
    button("Download", () => download(artifact, shown)),
  );
}

function draw(artifact, versions) {
  const shown = versions.find(({ version }) => version === view.version) ?? versions.at(-1);
  const author = shown.worker ? ` · by ${shown.worker}` : "";
  panel.replaceChildren(
    el("div", {
      class: "panel-grip",
      role: "separator",
      "aria-label": "Resize the panel",
      "aria-orientation": "vertical",
      tabindex: "0",
    }),
    el(
      "header",
      { class: "panel-head" },
      el("h2", {}, artifact.title),
      el(
        "span",
        { class: "meta" },
        `${artifact.kind}${artifact.language ? ` · ${artifact.language}` : ""}${author}`,
      ),
      el(
        "button",
        { type: "button", class: "ghost", "aria-label": "Close the panel", onclick: closePanel },
        "×",
      ),
    ),
    toolbar(artifact, versions, shown),
    el("div", { class: "panel-body" }, body(artifact, versions, shown)),
  );
  panel.hidden = false;
  grip(panel.querySelector(".panel-grip"));
}

export async function openArtifact(id) {
  const { artifact, versions } = await call("GET", `/api/artifacts/${id}`);
  view.id = id;
  view.version = versions.at(-1)?.version ?? 1;
  view.mode = artifact.kind === "markdown" ? "preview" : "code";
  draw(artifact, versions);
}

export function closePanel() {
  panel.hidden = true;
  view.id = null;
}

// Dragging the panel's edge sets its width, from 360px to 60% of the window.
function grip(handle) {
  const width = Number(stored("amora.panel.width"));
  if (width) panel.style.width = `${width}px`;
  handle.addEventListener("pointerdown", (start) => {
    handle.setPointerCapture(start.pointerId);
    const move = (event) => {
      const next = Math.min(
        Math.max(globalThis.innerWidth - event.clientX, 360),
        globalThis.innerWidth * 0.6,
      );
      panel.style.width = `${next}px`;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener(
      "pointerup",
      () => (
        handle.removeEventListener("pointermove", move),
        stored("amora.panel.width", String(parseInt(panel.style.width, 10)))
      ),
      { once: true },
    );
  });
}

const kinds = { "": "All", markdown: "Documents", code: "Code" };

function artifactRow(artifact) {
  const language = artifact.language ? ` · ${artifact.language}` : "";
  const count = artifact.versions === 1 ? "1 version" : `${artifact.versions} versions`;
  const when = new Date(artifact.updatedAt).toLocaleString();
  return button(
    [
      el("span", { class: "picker-name" }, artifact.title),
      el("span", { class: "meta" }, `${artifact.kind}${language} · ${count} · ${when}`),
    ],
    () => void openArtifact(artifact.id),
    "picker-item",
  );
}

async function library(container, kind) {
  const { artifacts } = await call("GET", `/api/artifacts${kind ? `?kind=${kind}` : ""}`);
  const filter = el(
    "div",
    { class: "tabs" },
    Object.entries(kinds).map(([value, label]) =>
      button(label, () => void library(container, value), "tab", {
        "aria-selected": String(value === kind),
      }),
    ),
  );
  const rows = artifacts.length
    ? artifacts.map(artifactRow)
    : [el("p", { class: "empty-note" }, "Artifacts from your chats appear here.")];
  const page = el(
    "div",
    { class: "page" },
    el("div", { class: "page-head" }, el("h1", {}, "Artifacts")),
    filter,
    el("div", { class: "box picker-list artifact-list" }, rows),
  );
  container.replaceChildren(page);
}

// /artifacts, and /artifacts?open=<id> with that artifact in the panel.
export async function showArtifacts(container) {
  await library(container, "");
  const wanted = new URLSearchParams(globalThis.location.search).get("open");
  if (wanted) await openArtifact(wanted);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && view.id && !document.querySelector("dialog[open]")) closePanel();
});

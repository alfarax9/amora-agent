import { el } from "./dom.js";

// Reviewing what Complete would change: each file's diff, and a note per file
// that sends the work back to the step that wrote it.

function lineClass(line) {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return undefined;
}

function fileBlock(task, change, index) {
  const field = `note-${task.id}-${index}`;
  const lines = change.diff
    .split("\n")
    .map((line) => el("span", { class: lineClass(line) }, `${line}\n`));
  return el(
    "details",
    { id: `diff-${task.id}-${index}` },
    el("summary", {}, `${change.status === "added" ? "New" : "Changed"}: ${change.path}`),
    el("pre", { class: "diff" }, lines),
    el("label", { for: field }, `Note on ${change.path}`),
    el("textarea", { id: field, rows: 2 }),
  );
}

export function reviewCard(task, act) {
  if (!task.changes?.length) return null;
  const fields = () =>
    task.changes.map((change, index) => document.getElementById(`note-${task.id}-${index}`));
  // Sent notes go into the transcript, so the fields are emptied for the next
  // review; refused ones stay for the owner to fix.
  const send = async () => {
    const notes = task.changes
      .map((change, index) => ({ file: change.path, text: fields()[index]?.value ?? "" }))
      .filter(({ text }) => text.trim() !== "");
    if (!(await act(task.id, "decide", { action: "changes", notes }))) return;
    for (const field of fields()) if (field) field.value = "";
  };
  return el(
    "div",
    { class: "card" },
    el(
      "p",
      {},
      el("strong", {}, "Review the changes. "),
      `Completing changes ${task.changes.length} files. Open one to see its diff; a note on it sends that work back before you complete.`,
    ),
    task.changes.map((change, index) => fileBlock(task, change, index)),
    el("button", { type: "button", class: "secondary", onclick: send }, "Send the notes back"),
  );
}

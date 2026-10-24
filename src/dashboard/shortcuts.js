import { go } from "./router.js";
import { openSearch } from "./search.js";
import { toggleSidebar } from "./shell.js";

// The app's keyboard shortcuts (app spec §17). The app runs in a browser tab,
// so it never takes a shortcut the browser keeps for itself. Mod is Cmd on a
// Mac and Ctrl elsewhere. Esc stops a reply and Mod+Enter approves the
// focused card; chat.js and cards.js handle those where they apply.

const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator.platform);
const typing = () => document.activeElement?.matches?.("input, textarea, select") ?? false;

function switchMode() {
  const mode = document.getElementById("app").dataset.mode === "chat" ? "code" : "chat";
  go(new URL(document.getElementById(`mode-${mode}`).href).pathname);
}

function focusComposer() {
  const input = ["chat-input", "brief"]
    .map((id) => document.getElementById(id))
    .find((field) => field?.offsetParent && !field.disabled);
  input?.focus();
}

const withMod = {
  k: () => openSearch(),
  b: () => toggleSidebar(),
  ".": () => globalThis.dispatchEvent(new Event("amora:panel")),
};

const withModShift = { o: () => go("/"), m: switchMode };

function shortcut(event) {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();
  const action = mod ? (event.shiftKey ? withModShift[key] : withMod[key]) : undefined;
  if (action) return (event.preventDefault(), action());
  if (event.key === "/" && !mod && !typing()) {
    event.preventDefault();
    focusComposer();
  }
}

export function initShortcuts() {
  document.addEventListener("keydown", shortcut);
}

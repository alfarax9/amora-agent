import { el } from "./dom.js";
import { renderCosts } from "./costs.js";
import { renderModels } from "./models.js";
import { renderWorkers } from "./workers.js";

// Workers, Models, and Costs read their own route when the page opens and at
// most every ten seconds while it stays open: the chat's two-second poll would
// ask the keychain and the price list far too often.

const pages = {
  workers: { title: "Workers", render: renderWorkers },
  models: { title: "Models", render: renderModels },
  costs: { title: "Costs", render: renderCosts },
};

export const reportPages = Object.keys(pages);

const refreshMs = 10_000;
const loaded = new Map();

async function read(page) {
  let response;
  try {
    response = await fetch(`/api/${page}`);
  } catch {
    throw new Error("The runtime is not answering. Is amora still running?");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error ?? "The runtime could not read this page. Check its log.");
  return body;
}

// Calls redraw once the page's report arrived, or failed to.
export async function loadReport(page, redraw) {
  const last = loaded.get(page);
  if (!pages[page] || (last && Date.now() - last.at < refreshMs)) return;
  loaded.set(page, { ...last, at: Date.now() });
  try {
    loaded.set(page, { at: Date.now(), report: await read(page) });
  } catch (error) {
    loaded.set(page, { ...loaded.get(page), error: error.message });
  }
  redraw();
}

export function renderReport(page, data) {
  const { title, render } = pages[page];
  const state = loaded.get(page) ?? {};
  const body = state.report
    ? render(state.report, data)
    : [el("p", { class: "empty-note" }, state.error ? "" : "Reading…")];
  return el(
    "div",
    { class: "page" },
    el("div", { class: "page-head" }, el("h1", {}, title)),
    state.error ? el("p", { class: "error", role: "alert" }, state.error) : null,
    body.flat(),
  );
}

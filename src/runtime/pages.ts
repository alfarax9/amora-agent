import { chatComposer, codeComposer, dialogs, sidebar, topbar } from "./app-shell.ts";
import { chatStyle } from "./chat-style.ts";
import { shellStyle } from "./shell-style.ts";
import { dashboardStyle } from "./dashboard-style.ts";

// The runtime's pages. Everything is served from this origin: the runtime
// never loads anything from a third-party host.

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function page(title: string, body: string, layout = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · AMORA</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #080b11; color: #d1d5db; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 36rem; margin: 15vh auto; padding: 0 1.5rem; }
  h1 { color: #fff; font-size: 1.5rem; }
  code { font-family: ui-monospace, monospace; color: #fff; }
  .button { display: inline-block; background: #2563eb; color: #fff; border-radius: 999px; padding: .6rem 1.2rem; text-decoration: none; }
  .button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
</style>
</head>
<body><main${layout ? ` class="${layout}"` : ""}>${body}</main></body>
</html>`;
}

export function messagePage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

// Settings: the gateway, the daily limit, and the OpenRouter key's own credit
// limit (key-limit.ts). The management key field is a password field the
// script empties after every attempt.
// What a task costs depends on the models the owner assigns, so the limit is
// a choice of ceilings from a small test to heavy use, or none, or any amount.
const presetLimits = [2, 5, 10, 20, 50, 100, 200, 500, 1000];

const limitChoice = (value: string, label: string) =>
  `<label class="choice"><input type="radio" name="limit-choice" value="${value}"><span>${label}</span></label>`;

const limitChoices = [
  ...presetLimits.map((usd) => limitChoice(String(usd), `$${usd}`)),
  limitChoice("none", "No limit"),
  limitChoice("other", "Other"),
].join("\n");

const creditLimit = `<section id="credit-limit-panel" class="box">
<h2>OpenRouter credit limit</h2>
<p id="credit-limit" class="meta" aria-live="polite">Reading the key's limit…</p>
<fieldset class="choices">
<legend>Limit in USD. What a task costs depends on the models you assign, so pick the ceiling that fits them; OpenRouter stops this key there.</legend>
${limitChoices}
</fieldset>
<div id="other-limit" hidden>
<label for="limit-usd">Other amount in USD</label>
<input id="limit-usd" type="number" min="0.01" step="0.01">
</div>
<label for="limit-reset">Resets</label>
<select id="limit-reset">
<option value="">Never</option>
<option value="daily">Daily (midnight UTC)</option>
<option value="weekly">Weekly (Monday, midnight UTC)</option>
<option value="monthly">Monthly (the 1st, midnight UTC)</option>
</select>
<label for="management-key">Management key, from openrouter.ai/settings/management-keys (used for this change only, never stored)</label>
<input id="management-key" type="password" autocomplete="off" spellcheck="false">
<div class="actions"><button id="save-limit" type="button" class="primary">Set limit</button></div>
<p id="limit-error" class="error" role="alert"></p>
</section>`;

// The owner's rules go to Chat and to every worker of the code team.
const rules = `<section class="box">
<h2>Your rules</h2>
<p class="meta">Chat and the team follow these in every reply: the language to answer in, a tone, what to leave out. Without rules, replies follow the language you write in.</p>
<label for="rules-text">Rules</label>
<textarea id="rules-text" rows="5" maxlength="4000" placeholder="Always answer in Indonesian. Keep answers short."></textarea>
<div class="actions"><button id="save-rules" type="button" class="primary">Save rules</button><span id="rules-saved" class="meta" aria-live="polite"></span></div>
<p id="rules-error" class="error" role="alert"></p>
</section>`;

function settingsPage(gateway: string, keyed: boolean): string {
  return `<section id="settings-view" class="page settings" aria-labelledby="settings-title" hidden>
<div class="page-head"><h1 id="settings-title">Settings</h1></div>
${rules}
<section class="box"><h2>Gateway</h2><p>${gateway}</p></section>
<section class="box"><h2>Budget</h2><p id="settings-budget" class="meta"></p>
<p class="meta">Change the daily limit with <code>amora budget --daily &lt;usd&gt;</code>.</p>
<label for="task-budget">Budget for each task started from Chat, in USD</label>
<div class="actions"><input id="task-budget" type="number" min="0.01" step="0.01"><button id="save-task-budget" type="button" class="secondary">Save</button><span id="task-budget-saved" class="meta" aria-live="polite"></span></div>
<p id="task-budget-error" class="error" role="alert"></p></section>
${keyed ? creditLimit : ""}
</section>`;
}

// The AMORA App (the app spec, milestone A1): one page for every path, whose
// scripts draw the page the address names (router.js). The frame is in
// app-shell.ts; the page is static, and its scripts fetch the API and render
// with text nodes only.
export function dashboardPage(state: { maskedKey?: string; chat: boolean }): string {
  const gateway = state.maskedKey
    ? `OpenRouter connected (key <code>${escapeHtml(state.maskedKey)}</code>)`
    : `<a href="/connect/openrouter" target="_blank" rel="noopener">Connect OpenRouter</a> (opens a new tab; reload here when it says connected)`;
  const view = state.chat
    ? `<div id="view" class="main-view"></div>`
    : `<div class="page"><p class="meta">The agency chat is not running in this process.</p></div>`;
  return page(
    "Chat",
    `<style>${dashboardStyle}${shellStyle}${chatStyle}</style>
<div class="app" id="app" data-mode="chat" data-gateway="${state.maskedKey ? "connected" : "missing"}">
${topbar}
${sidebar}
<div class="main" id="main"><p id="action-error" class="error" role="alert"></p>${view}${settingsPage(gateway, state.maskedKey !== undefined)}</div>
<aside id="panel" class="panel" aria-label="Side panel" hidden></aside>
</div>
${state.chat ? codeComposer + chatComposer + dialogs : ""}
<script type="module" src="/dashboard/settings.js"></script>
${state.chat ? `<script type="module" src="/dashboard/app.js"></script>` : ""}`,
    "dashboard",
  );
}

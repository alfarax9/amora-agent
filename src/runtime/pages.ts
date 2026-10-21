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
const creditLimit = `<section id="credit-limit-panel" class="box">
<h2>OpenRouter credit limit</h2>
<p id="credit-limit" class="meta" aria-live="polite">Reading the key's limit…</p>
<label for="limit-usd">Limit in USD (empty for no limit)</label>
<input id="limit-usd" type="number" min="0.01" step="0.01">
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

function settingsPage(gateway: string, keyed: boolean): string {
  return `<section id="settings-view" class="page settings" aria-labelledby="settings-title" hidden>
<div class="page-head"><h1 id="settings-title">Settings</h1></div>
<section class="box"><h2>Gateway</h2><p>${gateway}</p></section>
<section class="box"><h2>Budget</h2><p id="settings-budget" class="meta"></p>
<p class="meta">Change the daily limit with <code>amora budget --daily &lt;usd&gt;</code>.</p></section>
${keyed ? creditLimit : ""}
</section>`;
}

// The composer is one element the script moves between the new-task page and
// a task's thread, so what the owner is typing survives every re-render.
const composer = `<div id="composer" class="composer-wrap" hidden>
<div class="composer">
<textarea id="brief" rows="1" aria-label="Message to the agency" placeholder="Message the agency"></textarea>
<button id="send" type="button" class="send" aria-label="Send" title="Send (Enter)">↑</button>
</div>
<div class="composer-row">
<label id="budget-field" for="budget">Task budget $<input id="budget" type="number" min="0.01" step="0.01" value="1.00"></label>
<span id="composer-note"></span>
</div>
<p id="composer-error" class="error" role="alert"></p>
</div>`;

const topbar = `<header class="topbar">
<ul class="status-list">
<li><button id="toggle-sidebar" type="button" class="secondary only-narrow" aria-label="Show navigation">☰</button></li>
<li class="here"><svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> <span id="address"></span></li>
<li>Orchestrator <span id="orchestrator-status" class="ok">OK</span></li>
<li id="gateway-item">Gateway <span id="gateway-status"></span></li>
</ul>
<div class="top-right">
<span id="budget-meter" class="budget wide-only"></span>
<button id="pause" type="button" class="secondary" hidden>Pause all workers</button>
</div>
</header>`;

const sidebar = `<nav class="sidebar" aria-label="Dashboard">
<a id="new-task" href="#new" class="primary new-task"><span aria-hidden="true">+</span> New task</a>
<div class="nav">
<a class="nav-item" data-route="overview" href="#overview">Overview</a>
<a class="nav-item" data-route="tasks" href="#tasks">Tasks <span id="decision-count" class="count" hidden></span></a>
<a class="nav-item" data-route="workers" href="#workers">Workers</a>
<a class="nav-item" data-route="models" href="#models">Models</a>
<a class="nav-item" data-route="costs" href="#costs">Costs</a>
<a class="nav-item" data-route="settings" href="#settings">Settings</a>
</div>
<p class="section-title">Recent</p>
<div id="recent" class="recent"></div>
</nav>`;

// The agency (PRD §8 and the dashboard PRD), after the AMORA website: a top
// bar with the runtime's state, the budget, and Pause on every page; New task
// and the pages in the sidebar; Overview, Tasks, a task's thread with its
// plan, changes, and log beside it, Workers, Models, Costs, and Settings. The
// page is static; its scripts fetch /api/tasks and the read-only report routes
// and render with text nodes only.
export function dashboardPage(state: { maskedKey?: string; chat: boolean }): string {
  const gateway = state.maskedKey
    ? `OpenRouter connected (key <code>${escapeHtml(state.maskedKey)}</code>)`
    : `<a href="/connect/openrouter" target="_blank" rel="noopener">Connect OpenRouter</a> (opens a new tab; reload here when it says connected)`;
  const view = state.chat
    ? `<div id="view" class="main-view"></div>`
    : `<div class="page"><p class="meta">The agency chat is not running in this process.</p></div>`;
  return page(
    "Agency",
    `<style>${dashboardStyle}</style>
<div class="app" id="app" data-gateway="${state.maskedKey ? "connected" : "missing"}">
${topbar}
${sidebar}
<div class="main"><p id="action-error" class="error" role="alert"></p>${view}${settingsPage(gateway, state.maskedKey !== undefined)}</div>
<aside id="panel" class="panel" aria-label="Task details" hidden></aside>
</div>
${state.chat ? composer : ""}
<script type="module" src="/dashboard/settings.js"></script>
${state.chat ? `<script type="module" src="/dashboard/app.js"></script>` : ""}`,
    "dashboard",
  );
}

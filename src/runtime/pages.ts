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

const dashboardStyle = `
  main.dashboard { max-width: 52rem; margin: 0 auto; padding: 1.5rem; }
  header { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between; border-bottom: 1px solid #1f2937; padding-bottom: 1rem; }
  header h1 { margin: 0; font-size: 1.25rem; }
  .meta { color: #9ca3af; font-size: .875rem; }
  .thread { border: 1px solid #1f2937; border-radius: .75rem; padding: 1rem; margin: 1rem 0; }
  .message { margin: .5rem 0; padding: .5rem .75rem; border-radius: .5rem; background: #0f141d; white-space: pre-wrap; }
  .message.owner { background: #13213d; margin-left: 3rem; }
  .message .who { display: block; font-size: .75rem; color: #9ca3af; }
  .card { border: 1px solid #2563eb; border-radius: .5rem; padding: .75rem; margin-top: .75rem; }
  .status { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; }
  ol { padding-left: 1.25rem; }
  textarea, input { width: 100%; box-sizing: border-box; background: #0a0d14; color: #fff; border: 1px solid #374151; border-radius: .5rem; padding: .5rem; font: inherit; }
  label { display: block; margin: .5rem 0 .25rem; font-size: .875rem; }
  button { background: #2563eb; color: #fff; border: 0; border-radius: 999px; padding: .5rem 1rem; font: inherit; cursor: pointer; margin: .5rem .5rem 0 0; }
  button.secondary { background: #1f2937; }
  button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: default; }
  .error { color: #ff6b6b; }
  table { width: 100%; border-collapse: collapse; font-size: .8125rem; }
  th, td { text-align: left; padding: .25rem .375rem; border-bottom: 1px solid #1f2937; vertical-align: top; }
  details { margin-top: .75rem; }
  .scroll { overflow-x: auto; }
  th, td { white-space: nowrap; }
  td:nth-child(5) { white-space: normal; min-width: 12rem; }
`;

// The agency chat (PRD §8). The page itself is static; its script fetches the
// tasks from /api/tasks and renders them with text nodes only.
export function dashboardPage(state: { maskedKey?: string; chat: boolean }): string {
  const gateway = state.maskedKey
    ? `OpenRouter connected (key <code>${escapeHtml(state.maskedKey)}</code>)`
    : `<a href="/connect/openrouter" target="_blank" rel="noopener">Connect OpenRouter</a> (opens a new tab; reload here when it says connected)`;
  const chat = state.chat
    ? `<div id="threads" aria-live="polite"></div>
<section aria-labelledby="new-task">
<h2 id="new-task">New task</h2>
<label for="brief">What should the agency build?</label>
<textarea id="brief" rows="4"></textarea>
<label for="budget">Task budget in USD</label>
<input id="budget" type="number" min="0.01" step="0.01" value="1.00">
<button id="send" type="button">Send to the agency</button>
<p id="composer-error" class="error" role="alert"></p>
</section>
<script type="module" src="/dashboard/app.js"></script>`
    : "<p>The agency chat is not running in this process.</p>";
  return page(
    "Agency",
    `<style>${dashboardStyle}</style>
<header>
<h1>AMORA agency</h1>
<p class="meta">${gateway}</p>
<p class="meta" id="budget-meter"></p>
<button id="pause" type="button" class="secondary" hidden>Pause all workers</button>
</header>
<p id="action-error" class="error" role="alert"></p>
${chat}`,
    "dashboard",
  );
}

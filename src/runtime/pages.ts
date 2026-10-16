// Minimal pages served until the dashboard ships (M1). Everything is inline:
// the runtime never loads anything from a third-party host.

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function page(title: string, body: string): string {
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
<body><main>${body}</main></body>
</html>`;
}

export function messagePage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

export function statusPage(openRouter: { maskedKey?: string }): string {
  const gateway = openRouter.maskedKey
    ? `<p>OpenRouter is connected (key <code>${escapeHtml(openRouter.maskedKey)}</code>).</p>`
    : `<p>No model gateway is connected yet.</p>
<p>OpenRouter opens in a new tab. When it says you are connected, come back here and reload.</p>
<p><a class="button" href="/connect/openrouter" target="_blank" rel="noopener">Connect OpenRouter</a></p>`;
  return page(
    "Runtime",
    `<h1>AMORA is running</h1>
<p>The dashboard arrives in the next milestone. For now this page connects a gateway, and <code>amora doctor</code> checks the setup.</p>
${gateway}`,
  );
}

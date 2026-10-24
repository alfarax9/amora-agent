// Chat's look (app spec §8.2 to §8.5): the composer with its intent, target,
// and brain; the owner's messages as blocks on the overlay; each worker's
// reply flat in the reading column under its header; the agency's cards; and
// Markdown with tables and code blocks. Tokens from dashboard-style.ts only.

export const chatStyle = `
  .app[data-mode="chat"] .for-code, .app:not([data-mode="chat"]) .for-chat { display: none !important; }
  .app[data-mode="chat"] #pause { display: none !important; }
  .ghost { border-radius: var(--pill); padding: .25rem .6rem; font-size: .75rem; color: var(--text-tertiary); border: 1px solid transparent; }
  .ghost:hover { border-color: var(--border-strong); color: var(--text); }
  .chip { display: inline-flex; align-items: center; gap: .375rem; border: 1px solid var(--border); border-radius: var(--pill); padding: .2rem .65rem; font-size: .75rem; color: var(--text-secondary); background: var(--overlay); }
  .select-chip select { border: 0; background: transparent; padding: 0; font-size: .75rem; color: var(--text); }
  .settings textarea { width: 100%; resize: vertical; }

  .chat-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .chat-composer { flex-direction: column; align-items: stretch; gap: .25rem; padding: .625rem .625rem .5rem 1rem; border-radius: var(--radius); background: var(--bg-alt); }
  .chat-composer textarea { max-height: 40vh; }
  .composer-tools { display: flex; align-items: center; gap: .5rem; }
  .brain { margin-left: auto; font-size: .75rem; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-start h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; }
  .suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: .5rem; margin-top: 1rem; }
  .suggestion { cursor: pointer; }
  .suggestion:hover { border-color: var(--border-strong); color: var(--text); }
  .title-button { flex: 1; min-width: 0; text-align: left; }
  .title-button h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.125rem; line-height: 1.75rem; font-weight: 600; }

  .chat-messages { gap: 1.5rem; max-width: 46rem; }
  .you { flex-direction: column; align-items: stretch; gap: .25rem; }
  .user-block { background: var(--overlay); border-radius: var(--radius); padding: .625rem .875rem; color: var(--text); }
  .user-block p { margin: 0; white-space: pre-wrap; font-size: .9375rem; line-height: 1.5rem; }
  .user-block textarea { width: 100%; resize: vertical; }
  .message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .125rem; min-height: 1.5rem; }
  .you .message-actions { justify-content: flex-end; opacity: 0; }
  .you:hover .message-actions, .you:focus-within .message-actions { opacity: 1; }
  .versions { display: inline-flex; align-items: center; gap: .125rem; font-size: .75rem; color: var(--text-tertiary); font-feature-settings: "tnum"; }
  .reply { display: flex; align-items: flex-start; gap: .75rem; }
  .reply .mascot, .reply .agency-mark { width: 32px; height: 32px; }
  .reply-body { flex: 1; min-width: 0; }
  .worker-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; margin: .125rem 0 .375rem; font-size: .8125rem; }
  .worker-head strong { color: var(--text); font-weight: 600; }
  .worker-head .division-name { color: var(--division, var(--text-secondary)); }
  .reply .typing { padding: .5rem 0; }
  .message-actions .error { margin: 0 .5rem 0 0; }

  .prose { color: var(--text-secondary); font-size: .9375rem; line-height: 1.5rem; overflow-wrap: anywhere; }
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  .prose p, .prose ul, .prose ol, .prose blockquote, .prose figure, .prose .table-wrap { margin: 0 0 .75rem; }
  .prose ul, .prose ol { padding-left: 1.4rem; }
  .prose li + li { margin-top: .25rem; }
  .prose h3 { color: var(--text); font-size: 1.0625rem; font-weight: 600; margin: 1.25rem 0 .5rem; }
  .prose h4 { color: var(--text); font-size: .9375rem; font-weight: 600; margin: 1rem 0 .4rem; }
  .prose blockquote { border-left: 2px solid var(--border-strong); padding-left: .875rem; }
  .prose strong { color: var(--text); font-weight: 600; }
  .prose code { font-size: .8125rem; background: var(--overlay); border-radius: .3rem; padding: .05rem .3rem; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
  .table-wrap table { font-size: .8125rem; }
  .table-wrap th, .table-wrap td { padding: .4rem .75rem; border-top: 1px solid var(--border); }
  .table-wrap th { border-top: 0; color: var(--text); }
  .code-block { margin: 0 0 .75rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-alt); overflow: hidden; }
  .code-block figcaption { display: flex; align-items: center; gap: .25rem; padding: .25rem .375rem .25rem .875rem; border-bottom: 1px solid var(--border); }
  .code-block .lang { flex: 1; font-family: var(--font-mono); font-size: .75rem; color: var(--text-tertiary); }
  pre.code { margin: 0; padding: .75rem .875rem; overflow-x: auto; font-size: .8125rem; line-height: 1.25rem; color: var(--text); }
  pre.code code { background: none; padding: 0; white-space: pre; }
  .tok-comment { color: var(--text-tertiary); }
  .tok-string { color: var(--amber); }
  .tok-number { color: var(--highlight-from); }
  .tok-keyword { color: var(--highlight-to); }

  .agency-card { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-alt); padding: .875rem 1rem; color: var(--text-secondary); font-size: .875rem; }
  .agency-card:focus-visible { outline: 2px solid var(--accent-glow); outline-offset: 2px; }
  .agency-card h3 { color: var(--text); font-size: 1rem; font-weight: 600; margin: 0 0 .5rem; }
  .agency-card p { margin: 0 0 .5rem; }
  .agency-card input, .agency-card textarea { width: 100%; margin-top: .5rem; }
  .division-steps { border-left: 2px solid var(--division, var(--border-strong)); padding-left: .75rem; margin: .5rem 0; }
  .division-steps .division-name { margin: 0; font-size: .75rem; color: var(--division, var(--text-secondary)); }
  .division-steps ol { margin: .25rem 0 0; padding-left: 1.1rem; }
  .division-steps strong { color: var(--text); font-weight: 500; }
  .gate-list { list-style: none; padding: 0; margin: .5rem 0 0; display: flex; flex-direction: column; gap: .375rem; font-size: .8125rem; }
  .gate-list li { display: flex; gap: .5rem; align-items: baseline; }
  .progress-line { display: flex; align-items: center; gap: .625rem; }
`;

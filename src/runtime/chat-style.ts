// The look of the two modes and of Chat, in the dashboard's own tokens
// (dashboard-style.ts). A reply reads like a chat app's: the user's message in
// a bubble on the right, the reply as plain prose under the agency mark, with
// code in blocks and actions underneath.

export const chatStyle = `
  .app[data-mode="chat"] .for-code, .app:not([data-mode="chat"]) .for-chat { display: none !important; }
  .app[data-mode="chat"] #pause { display: none !important; }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-alt); }
  .mode { display: flex; align-items: center; justify-content: center; gap: .375rem; border-radius: calc(var(--radius) - 3px); padding: .4rem .5rem; font-size: .8125rem; color: var(--text-3); text-decoration: none; white-space: nowrap; }
  .mode:hover { color: var(--text); }
  .mode[aria-current] { background: var(--overlay); color: var(--text); }
  .group-title { margin: .5rem .75rem .125rem; font-size: .6875rem; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-title:first-child { margin-top: 0; }
  .sidebar-foot { margin-top: auto; border-top: 1px solid var(--border); padding-top: .5rem; }
  .ghost { border-radius: var(--radius); padding: .3rem .6rem; font-size: .75rem; color: var(--text-3); }
  .ghost:hover { background: var(--overlay); color: var(--text); }
  .model-chip select { border-radius: 999px; padding: .2rem .6rem; font-size: .75rem; max-width: 16rem; background: transparent; }
  .settings textarea { width: 100%; resize: vertical; }

  .chat-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .chat-messages { gap: 1.5rem; }
  .reply { display: flex; align-items: flex-start; gap: .75rem; }
  .reply .agency-mark { width: 26px; height: 26px; border-radius: .45rem; font-size: .75rem; }
  .reply-body { flex: 1; min-width: 0; }
  .reply .typing { padding: .5rem 0; }
  .reply-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; margin-top: .375rem; }
  .reply-actions .error { margin: 0 .5rem 0 0; }

  .prose { color: var(--text); font-size: .9375rem; line-height: 1.65; overflow-wrap: anywhere; }
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  .prose p, .prose ul, .prose ol, .prose blockquote, .prose pre { margin: 0 0 .75rem; }
  .prose ul, .prose ol { padding-left: 1.4rem; }
  .prose li + li { margin-top: .25rem; }
  .prose h3 { font-size: 1.0625rem; font-weight: 600; margin: 1.25rem 0 .5rem; }
  .prose h4 { font-size: .9375rem; font-weight: 600; margin: 1rem 0 .4rem; }
  .prose blockquote { border-left: 2px solid var(--border-strong); padding-left: .875rem; color: var(--text-2); }
  .prose strong { font-weight: 600; }
  .prose code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .8125rem; background: var(--overlay); border-radius: .3rem; padding: .05rem .3rem; }
  .prose pre.code { background: var(--bg-alt); border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem .875rem; overflow-x: auto; }
  .prose pre.code code { background: none; padding: 0; white-space: pre; line-height: 1.5; }
`;

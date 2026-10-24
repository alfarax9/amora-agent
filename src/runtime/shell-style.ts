// The AMORA App's frame (app spec §6, §7, §13): the sidebar, which collapses
// to a rail of icons; the top bar; the side panel, resizable and an overlay on
// narrower windows; status shapes; and the search and picker dialogs. Every
// colour is a token from dashboard-style.ts; elevation comes from surface
// steps and borders, not shadows.

export const shellStyle = `
  .app { --sidebar: 260px; display: grid; grid-template: "side top top" auto "side main panel" minmax(0, 1fr) / var(--sidebar) minmax(0, 1fr) auto; height: 100vh; }
  .app.collapsed { --sidebar: 56px; }
  .sr-only { position: absolute; top: 0; left: 0; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .icon-button { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius); color: var(--text-tertiary); }
  .icon-button:hover { background: var(--overlay); color: var(--text); }
  kbd { font-size: .6875rem; color: var(--text-tertiary); border: 1px solid var(--border); border-radius: .3rem; padding: 0 .3rem; }

  .sidebar { grid-area: side; display: flex; flex-direction: column; gap: .75rem; min-height: 0; overflow-y: auto; padding: .75rem .625rem; background: var(--bg-alt); border-right: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: .5rem; padding: 0 .25rem; }
  .brand-mark { width: 24px; height: 24px; image-rendering: pixelated; }
  .brand-name { flex: 1; color: var(--text); font-weight: 600; letter-spacing: .02em; }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius); }
  .mode { display: flex; align-items: center; justify-content: center; gap: .375rem; border-radius: 6px; padding: .4rem .5rem; font-size: .8125rem; color: var(--text-tertiary); text-decoration: none; white-space: nowrap; }
  .mode:hover { color: var(--text); }
  .mode[aria-current] { background: var(--overlay); color: var(--text); }
  .new-task { display: flex; align-items: center; gap: .5rem; border: 1px solid var(--border-strong); border-radius: var(--pill); padding: .45rem .875rem; color: var(--text); font-size: .875rem; font-weight: 500; text-decoration: none; }
  .new-task:hover { border-color: var(--accent-glow); }
  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-item { display: flex; align-items: center; gap: .625rem; width: 100%; text-align: left; border-radius: var(--radius); padding: .45rem .625rem; font-size: .875rem; color: var(--text-secondary); text-decoration: none; }
  .nav-item > span:first-of-type { flex: 1; }
  .nav-item[aria-current] { background: var(--overlay); color: var(--text); box-shadow: inset 2px 0 0 var(--accent-glow); }
  .count { font-size: .6875rem; border-radius: var(--pill); padding: 0 .45rem; background: var(--overlay); color: var(--text); }
  .group-title { margin: .625rem .625rem .125rem; font-size: .75rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent { display: flex; flex-direction: column; gap: 1px; }
  .task-link { display: flex; align-items: center; gap: .5rem; min-width: 0; border-radius: var(--radius); padding: .375rem .625rem; font-size: .8125rem; color: var(--text-secondary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-link[aria-current] { background: var(--overlay); color: var(--text); }
  .link-text { overflow: hidden; text-overflow: ellipsis; }
  .chat-row { position: relative; display: flex; align-items: center; }
  .chat-row .task-link { flex: 1; display: block; }
  .row-actions { position: relative; }
  .row-actions > summary { list-style: none; cursor: pointer; padding: .2rem .45rem; border-radius: var(--radius); color: var(--text-tertiary); opacity: 0; }
  .row-actions > summary::-webkit-details-marker { display: none; }
  .chat-row:hover .row-actions > summary, .row-actions[open] > summary, .row-actions > summary:focus-visible { opacity: 1; }
  .row-menu { position: absolute; right: 0; top: 100%; z-index: 5; display: flex; flex-direction: column; min-width: 11rem; padding: .25rem; background: var(--bg-alt); border: 1px solid var(--border-strong); border-radius: var(--radius); }
  .row-menu button { text-align: left; padding: .4rem .6rem; border-radius: 6px; font-size: .8125rem; }
  .row-menu button:hover { background: var(--overlay); }
  .trash-link { margin: .5rem .25rem 0; align-self: flex-start; }
  .sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: .375rem; border-top: 1px solid var(--border); padding-top: .625rem; }
  .foot-line { display: flex; align-items: center; gap: .5rem; margin: 0 .625rem; font-size: .75rem; color: var(--text-secondary); }
  .spend { margin-left: auto; color: var(--text); font-feature-settings: "tnum"; }

  .status { display: inline-flex; align-items: center; gap: .375rem; font-size: .75rem; color: var(--text-secondary); }
  .shape { width: .625rem; height: .625rem; flex: none; box-sizing: border-box; display: inline-grid; place-items: center; font-size: .5625rem; line-height: 1; color: var(--text); }
  [data-shape="running"] .shape { border-radius: 50%; background: var(--highlight-to); }
  [data-shape="idle"] .shape { border-radius: 50%; border: 1.5px solid var(--text-tertiary); }
  [data-shape="approval"] .shape::before { content: "!"; font-weight: 800; font-size: .75rem; color: var(--text); }
  [data-shape="done"] .shape::before { content: "✓"; font-size: .75rem; color: var(--highlight-from); }
  [data-shape="blocked"] .shape { background: var(--danger); }
  [data-shape="paused"] .shape { border-left: 3px solid var(--text-secondary); border-right: 3px solid var(--text-secondary); width: .5rem; }

  .topbar { grid-area: top; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; border-bottom: 1px solid var(--border); padding: .5rem 1rem; font-size: .75rem; }
  .main { grid-area: main; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .main-view { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .agency-tabs { padding: .5rem 1.5rem 0; border-bottom: 1px solid var(--border); }
  .agency-tabs .tab { text-decoration: none; }
  .tab[aria-current], .tab[aria-selected="true"] { background: var(--overlay); color: var(--text); }

  .panel { grid-area: panel; position: relative; width: 24rem; min-width: 360px; max-width: 60vw; border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; background: var(--bg-alt); }
  .panel-grip { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; }
  .panel-grip:hover, .panel-grip:focus-visible { background: var(--accent-glow); }
  .panel-head { display: flex; align-items: center; gap: .625rem; padding: .75rem 1rem; border-bottom: 1px solid var(--border); }
  .panel-head h2 { flex: 1; font-size: 1rem; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .artifact-tools { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; padding: .5rem 1rem; border-bottom: 1px solid var(--border); }
  .artifact-tools select { padding: .2rem .5rem; font-size: .75rem; }
  .diff .same { color: var(--text-secondary); }

  dialog.picker { background: var(--bg-alt); color: var(--text-secondary); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 1rem 1.125rem; width: min(36rem, calc(100vw - 2rem)); }
  .search-dialog { top: 12vh; margin-top: 0; }
  .search-results { max-height: 60vh; }
  .search-hit { display: grid; gap: .1rem; padding: .5rem .65rem; border-radius: var(--radius); text-decoration: none; color: var(--text-secondary); }
  .search-hit:hover, .search-hit:focus-visible { background: var(--overlay); }
  .search-title { color: var(--text); }
  mark { background: none; color: var(--text); font-weight: 700; }

  .only-narrow { display: none; }
  .app.collapsed .brand-name, .app.collapsed .mode span, .app.collapsed .new-task span, .app.collapsed .nav-item span, .app.collapsed .nav-item kbd,
  .app.collapsed .recent, .app.collapsed .foot-line { display: none; }
  .app.collapsed .modes { grid-template-columns: 1fr; }
  .app.collapsed .brand, .app.collapsed .nav-item, .app.collapsed .new-task { justify-content: center; padding-left: 0; padding-right: 0; }
  .app.collapsed #collapse svg { transform: rotate(180deg); }

  @media (max-width: 1279px) {
    .panel:not([hidden]) { position: fixed; right: 0; top: 0; bottom: 0; z-index: 3; width: min(28rem, 92vw); }
  }
  @media (max-width: 1023px) {
    .app, .app.collapsed { grid-template: "top" auto "main" minmax(0, 1fr) / minmax(0, 1fr); }
    .sidebar { position: fixed; inset: 0 auto 0 0; width: min(260px, 85vw); z-index: 4; transform: translateX(-100%); transition: transform .18s; }
    .app.sidebar-open .sidebar { transform: none; }
    .panel:not([hidden]) { width: 100vw; max-width: none; min-width: 0; }
    .only-narrow { display: inline-block; }
    .wide-only { display: none; }
    .cards { grid-template-columns: 1fr; }
    .card { margin-left: 0; }
  }
`;

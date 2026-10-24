// The dashboard's look, taken from the AMORA website's dashboard and agent
// thread: black page, raised surfaces, hairline borders, blue for actions
// only, and the blue-to-amber duo border on what needs the owner. Flat and
// dense, as the dashboard PRD asks (§9): no glow behind panels, no blur.
// Everything is inline; the page loads nothing from another origin.

export const dashboardStyle = `
  :root {
    color-scheme: dark;
    --bg: #000000; --bg-alt: #06070a; --surface: #0c0f16;
    --overlay: rgb(255 255 255 / .07); --border: rgb(255 255 255 / .08); --border-strong: rgb(255 255 255 / .16);
    --text: #ffffff; --text-secondary: #9ba9c4; --text-tertiary: #7c8597;
    --accent: #2563eb; --accent-glow: #3b82f6; --amber: #ffcd7d; --danger: #ff6b6b;
    --highlight-from: #38bdf8; --highlight-to: #60a5fa;
    --duo: linear-gradient(277deg, var(--accent-glow) 0%, var(--amber) 100%);
    --radius: 8px; --pill: 999px;
    --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Plus Jakarta Sans", system-ui, sans-serif;
    --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
    --division-atelier: oklch(.78 .1 355); --division-atlas: oklch(.78 .1 175); --division-bastion: oklch(.78 .1 265);
    --division-bridge: oklch(.78 .1 205); --division-compass: oklch(.78 .1 145); --division-crucible: oklch(.78 .1 25);
    --division-forge: oklch(.78 .1 55); --division-harbor: oklch(.78 .1 235); --division-ledger: oklch(.78 .1 115);
    --division-lens: oklch(.78 .1 85); --division-lyceum: oklch(.78 .1 325); --division-nexus: oklch(.78 .1 295);
  }
  body { background: var(--bg); color: var(--text-secondary); font: 14px/1.5 var(--font); font-feature-settings: "tnum"; }
  [hidden] { display: none !important; }
  main.dashboard { max-width: none; margin: 0; padding: 0; }
  h1, h2, h3 { color: var(--text); font-weight: 500; margin: 0; }
  a { color: var(--highlight-to); }
  code, pre, kbd, .mono { font-family: var(--font-mono); }
  code { color: var(--text); }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
  :focus-visible { outline: 2px solid var(--accent-glow); outline-offset: 3px; }
  button:disabled { opacity: .45; cursor: default; }
  .meta { color: var(--text-tertiary); font-size: .75rem; }
  .error { color: var(--danger); font-size: .8125rem; }
  .error:empty { display: none; }
  .duo { border: 1px solid transparent; background: linear-gradient(var(--fill, var(--bg)), var(--fill, var(--bg))) padding-box, var(--duo) border-box; }
  .primary { border-radius: var(--pill); padding: .45rem 1rem; color: var(--text); font-weight: 600; background: var(--accent); border: 1px solid var(--accent); }
  .primary:hover { border-color: var(--accent-glow); }
  .primary, .secondary { text-decoration: none; display: inline-block; }
  .secondary { border-radius: var(--pill); padding: .45rem .9rem; color: var(--text); border: 1px solid var(--border-strong); }
  .secondary.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
  .secondary:hover { border-color: var(--text-tertiary); }
  .nav-item:hover, .task-link:hover { background: var(--overlay); }
  input, textarea, select { background: var(--bg-alt); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: .45rem .6rem; font: inherit; box-sizing: border-box; }
  label { display: block; font-size: .75rem; color: var(--text-tertiary); margin: .75rem 0 .3rem; }

  .app { display: grid; grid-template: "top top top" auto "side main panel" minmax(0, 1fr) / 13rem minmax(0, 1fr) auto; height: 100vh; }
  .topbar { grid-area: top; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; border-bottom: 1px solid var(--border); padding: .6rem 1rem; font-size: .75rem; }
  .status-list { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem 1rem; list-style: none; margin: 0; padding: 0; color: var(--text-tertiary); }
  .status-list .here { color: var(--text); }
  .ok { color: var(--highlight-to); } .off { color: var(--text); }
  .top-right { display: flex; align-items: center; gap: 1rem; }
  .budget { display: flex; align-items: center; gap: .5rem; color: var(--text-tertiary); }
  .bar { width: 5rem; height: .375rem; border-radius: 999px; background: var(--overlay); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--highlight-to); }
  .bar.over span { background: var(--danger); }
  .budget b { color: var(--text); font-weight: 400; }

  .sidebar { grid-area: side; border-right: 1px solid var(--border); padding: .75rem; display: flex; flex-direction: column; gap: 1rem; min-height: 0; overflow-y: auto; }
  .new-task { display: flex; align-items: center; justify-content: center; gap: .4rem; font-size: .8125rem; }
  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-item { display: flex; justify-content: space-between; text-align: left; border-radius: var(--radius); padding: .5rem .75rem; font-size: .8125rem; color: var(--text-tertiary); text-decoration: none; }
  .nav-item[aria-current="page"] { background: var(--overlay); color: var(--text); }
  .count { font-size: .6875rem; border-radius: 999px; padding: 0 .4rem; background: var(--overlay); color: var(--text); }
  .section-title { font-size: .6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .06em; margin: 0 .75rem; }
  .recent { display: flex; flex-direction: column; gap: 2px; }
  .task-link { display: block; text-align: left; border-radius: var(--radius); padding: .4rem .75rem; font-size: .75rem; color: var(--text-secondary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-link[aria-current="page"] { background: var(--overlay); color: var(--text); }

  .main { grid-area: main; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .main-view { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .status-list li { display: flex; align-items: center; gap: .375rem; }
  .page { overflow-y: auto; padding: 1.25rem 1.5rem 2rem; display: flex; flex-direction: column; gap: 1rem; }
  .page-head { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .page-head h1 { font-size: 1.125rem; flex: 1; min-width: 0; }
  .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin: 0; }
  .stat { border-radius: var(--radius); padding: .75rem .9rem; border: 1px solid var(--border); background: var(--surface); }
  .stat.duo { --fill: var(--surface); }
  .stat dt { font-size: .75rem; color: var(--text-tertiary); }
  .stat dd { margin: .2rem 0 0; font-size: 1.375rem; color: var(--text); }
  .stat dd small { font-size: .75rem; color: var(--text-tertiary); margin-left: .25rem; }
  .approval { --fill: var(--surface); border-radius: var(--radius); padding: .75rem 1rem; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; color: var(--text); }
  .approval .actions { margin: 0; }
  .box { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); padding: 1rem; }
  .box h2 { font-size: .875rem; margin-bottom: .75rem; }
  .pipeline + .pipeline { margin-top: 1rem; }
  .pipeline-head { display: flex; justify-content: space-between; gap: .75rem; font-size: .75rem; color: var(--text); }
  .pipeline-head span { color: var(--text-tertiary); }
  .pipeline-head a, table a { color: var(--text); text-decoration: none; }
  .pipeline-head a:hover, table a:hover { text-decoration: underline; }
  .stages { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: .375rem; list-style: none; padding: 0; margin: .75rem 0 0; }
  .stages li { display: flex; flex-direction: column; gap: .375rem; font-size: .6875rem; color: var(--text-tertiary); }
  .stages li::before { content: ""; height: .25rem; border-radius: 999px; background: var(--overlay); }
  .stages li.done { color: var(--text-secondary); } .stages li.done::before { background: var(--duo); }
  .stages li.now { color: var(--text); font-weight: 600; } .stages li.now::before { background: var(--highlight-to); }
  table { width: 100%; border-collapse: collapse; font-size: .75rem; text-align: left; }
  th { color: var(--text-tertiary); font-weight: 400; padding: 0 .75rem .5rem 0; }
  td { padding: .6rem .75rem .6rem 0; border-top: 1px solid var(--border); color: var(--text-secondary); vertical-align: top; }
  .right { text-align: right; }
  th.right, td.right { padding-right: 0; }
  th.right + th, td.right + td { padding-left: .75rem; }
  .worker { display: flex; align-items: center; gap: .5rem; color: var(--text); }
  .dot { width: .375rem; height: .375rem; border-radius: 999px; flex: none; background: var(--division, var(--text-tertiary)); }
  .active { color: var(--highlight-to); } .failed { color: var(--danger); } .waiting { color: var(--text); } .passed { color: var(--highlight-from); }
  .row-link { cursor: pointer; } .row-link:hover td { background: var(--overlay); }
  .row-link a { color: var(--text); text-decoration: none; }
  .empty-note { color: var(--text-tertiary); font-size: .8125rem; padding: .5rem 0; }

  .thread-head { display: flex; align-items: center; gap: .75rem; padding: .75rem 1.25rem; border-bottom: 1px solid var(--border); font-size: .75rem; }
  .thread-head h1 { flex: 1; font-size: .9375rem; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip { border-radius: 999px; padding: .15rem .6rem; border: 1px solid var(--border-strong); color: var(--text-secondary); white-space: nowrap; }
  .live { display: inline-flex; align-items: center; gap: .375rem; color: var(--highlight-to); }
  .live::before { content: ""; width: .375rem; height: .375rem; border-radius: 999px; background: currentColor; animation: pulse 1.6s infinite; }
  .thread { flex: 1; overflow-y: auto; padding: 1.25rem; }
  .messages { max-width: 46rem; margin: 0 auto; display: flex; flex-direction: column; gap: .75rem; list-style: none; padding: 0; }
  .messages > li.new { animation: message-in .45s cubic-bezier(.2, .8, .2, 1) both; }
  .you { display: flex; justify-content: flex-end; }
  .you p { --fill: var(--surface); max-width: 80%; margin: 0; border-radius: 1rem 1rem .375rem 1rem; padding: .5rem .875rem; color: var(--text); white-space: pre-wrap; }
  .from { display: flex; align-items: flex-end; gap: .625rem; }
  .from .bubble { max-width: 82%; border: 1px solid var(--border-strong); background: var(--bg-alt); border-radius: 1rem 1rem 1rem .375rem; padding: .5rem .875rem; }
  .from .bubble p { margin: 0; }
  .from .name { font-size: .75rem; color: var(--division, var(--highlight-to)); }
  .from .bubble .text { margin-top: .125rem; color: var(--text); white-space: pre-wrap; }
  .from .bubble .detail { margin-top: .25rem; font-size: .6875rem; color: var(--text-tertiary); }
  .from .bubble .detail.failed { color: var(--danger); }
  .mascot { width: 32px; height: 32px; flex: none; image-rendering: pixelated; }
  .agency-mark { width: 32px; height: 32px; flex: none; border-radius: .5rem; display: grid; place-items: center; font-weight: 700; font-size: .8125rem; color: var(--bg); background: var(--duo); }
  .typing { display: flex; gap: .25rem; padding: .75rem .875rem; }
  .typing span { width: .375rem; height: .375rem; border-radius: 999px; background: var(--text); animation: typing-dot 1.1s ease-in-out infinite; }
  .typing span:nth-child(2) { animation-delay: .18s; } .typing span:nth-child(3) { animation-delay: .36s; }
  .card { --fill: var(--surface); border-radius: var(--radius); padding: .875rem 1rem; margin-left: 2.625rem; color: var(--text-secondary); }
  .card h2 { font-size: .875rem; margin-bottom: .5rem; }
  .card ol { padding-left: 1.25rem; margin: .5rem 0; } .card li { margin: .3rem 0; } .card strong { color: var(--text); font-weight: 500; }
  .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; align-items: center; }
  .banner { max-width: 46rem; margin: 0 auto .75rem; border: 1px solid var(--text); border-radius: var(--radius); padding: .5rem .875rem; font-size: .8125rem; color: var(--text); }

  .composer-wrap { padding: .5rem 1.25rem 1rem; }
  .composer { max-width: 46rem; margin: 0 auto; display: flex; align-items: flex-end; gap: .75rem; border: 1px solid var(--border-strong); background: var(--surface); border-radius: 1.5rem; padding: .375rem .375rem .375rem 1rem; }
  .composer:focus-within { border-color: var(--highlight-to); }
  .composer textarea { flex: 1; border: 0; background: transparent; resize: none; padding: .45rem 0; min-height: 1.5rem; max-height: 12rem; color: var(--text); }
  .composer textarea:focus-visible { outline: none; }
  .composer-row { max-width: 46rem; margin: .4rem auto 0; display: flex; align-items: center; gap: .75rem; font-size: .75rem; color: var(--text-tertiary); }
  .composer-row label { margin: 0; display: flex; align-items: center; gap: .375rem; }
  .composer-row input { width: 5.5rem; padding: .2rem .45rem; border-radius: .5rem; }
  .send { width: 2rem; height: 2rem; flex: none; border-radius: 999px; display: grid; place-items: center; background: var(--overlay); color: var(--text-tertiary); font-weight: 700; transition: background-color .12s; }
  .send.ready { background: var(--accent); color: var(--text); }
  .composer-wrap .error { max-width: 46rem; margin: .4rem auto 0; }
  .start { margin: auto; width: min(46rem, 100%); padding: 1.5rem; box-sizing: border-box; text-align: center; }
  .start h1 { font-size: 2rem; font-weight: 400; letter-spacing: -.02em; margin-bottom: .5rem; }
  .start .composer-wrap { padding: 1.25rem 0 0; text-align: left; }

  .panel { grid-area: panel; width: 24rem; border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; background: var(--bg-alt); }
  .tabs { display: flex; gap: .25rem; padding: .5rem; border-bottom: 1px solid var(--border); }
  .tab { border-radius: var(--radius); padding: .35rem .75rem; font-size: .8125rem; color: var(--text-tertiary); }
  .tab[aria-selected="true"] { background: var(--overlay); color: var(--text); }
  .panel-body { overflow: auto; padding: .875rem 1rem; flex: 1; font-size: .8125rem; }
  .panel .card { margin-left: 0; }
  .steps { list-style: none; padding: 0; margin: .5rem 0 0; display: flex; flex-direction: column; gap: .625rem; }
  .steps li { display: grid; grid-template-columns: 1.25rem 1fr; gap: .5rem; }
  .mark { color: var(--text-tertiary); } .mark.done { color: var(--highlight-from); } .mark.now { color: var(--highlight-to); }
  .scroll { overflow-x: auto; } .scroll td, .scroll th { white-space: nowrap; }
  .scroll td:nth-child(5) { white-space: normal; min-width: 10rem; }
  details { margin: .5rem 0; } summary { cursor: pointer; color: var(--text); }
  .diff { font-size: .75rem; overflow-x: auto; background: var(--bg); padding: .5rem; border-radius: .5rem; }
  .diff .add { color: var(--highlight-from); } .diff .del { color: var(--danger); } .diff .hunk { color: var(--highlight-to); }
  .panel textarea, .settings input, .settings select { width: 100%; }
  .settings { max-width: 40rem; }
  .project-chip { display: inline-flex; align-items: center; gap: .375rem; border: 1px solid var(--border-strong); border-radius: 999px; padding: .2rem .65rem; color: var(--text-secondary); font-size: .75rem; }
  .project-chip:hover { background: var(--overlay); color: var(--text); }
  dialog.picker { background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border-strong); border-radius: 1rem; padding: 1rem 1.125rem; width: min(32rem, calc(100vw - 2rem)); }
  dialog.picker::backdrop { background: transparent; }
  dialog.picker h2 { font-size: 1rem; margin-bottom: .75rem; }
  dialog.picker input { width: 100%; }
  .picker-list { display: flex; flex-direction: column; gap: 2px; margin: .5rem 0; max-height: 18rem; overflow-y: auto; }
  .picker-item { display: grid; gap: .1rem; width: 100%; text-align: left; border-radius: var(--radius); padding: .5rem .65rem; }
  .picker-item:hover:not(:disabled) { background: var(--overlay); }
  .picker-item[aria-current="true"] { background: var(--overlay); }
  .picker-name { color: var(--text); } .check { color: var(--highlight-to); }
  .picker-row { display: flex; align-items: flex-start; gap: .25rem; }
  .picker-row .picker-item { flex: 1; }
  .picker-row .set-up { align-self: center; padding: .3rem .7rem; font-size: .75rem; }
  .remove { color: var(--text-tertiary); border-radius: var(--radius); padding: .35rem .6rem; font-size: 1rem; line-height: 1; }
  .remove:hover { background: var(--overlay); color: var(--danger); }
  .picker-add { display: flex; align-items: center; justify-content: space-between; gap: .5rem; border-top: 1px solid var(--border); margin-top: .25rem; padding-top: .25rem; }
  .picker-item.add { width: auto; color: var(--text); }
  .warn { color: var(--text); font-size: .75rem; }
  .setup li .primary { margin: 0 .5rem .375rem 0; }
  .choices { border: 0; padding: 0; margin: .75rem 0 0; display: flex; flex-wrap: wrap; gap: .5rem; }
  .choices legend { font-size: .75rem; color: var(--text-tertiary); margin-bottom: .5rem; padding: 0; }
  .choice { margin: 0; position: relative; }
  .choice input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .choice span { display: inline-block; border: 1px solid var(--border-strong); border-radius: 999px; padding: .35rem .8rem; font-size: .8125rem; color: var(--text-secondary); cursor: pointer; }
  .choice span:hover { background: var(--overlay); color: var(--text); }
  .choice input:checked + span { color: var(--text); border-color: transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, var(--duo) border-box; }
  .choice input:focus-visible + span { outline: 2px solid var(--accent-glow); outline-offset: 2px; }

  .strong { color: var(--text); } .small { font-size: .75rem; margin: .25rem 0 0; }
  .chip.passed, .chip.failed, .chip.waiting { border-color: currentColor; }
  .division-head { display: flex; align-items: center; gap: .625rem; }
  .division-name { color: var(--division, var(--text)); }
  .worker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr)); gap: .75rem; }
  .worker-card { border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem .875rem; background: var(--bg-alt); font-size: .8125rem; min-width: 0; }
  .worker-card header { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
  .worker-card > p { margin: .375rem 0 0; }
  .worker-card h3 { font-size: .75rem; color: var(--text-tertiary); font-weight: 400; margin: .75rem 0 .25rem; }
  .worker-model { display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; overflow-wrap: anywhere; }
  .checks { display: flex; flex-wrap: wrap; gap: .25rem; list-style: none; padding: 0; margin: .5rem 0 0; }
  .check { border: 1px solid var(--border-strong); border-radius: .375rem; padding: 0 .375rem; font-size: .6875rem; color: var(--text-tertiary); cursor: help; }
  .check.passed, .check.failed { border-color: currentColor; }
  .handoffs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .25rem; font-size: .75rem; }
  .handoffs a { color: var(--text); text-decoration: none; } .handoffs a:hover { text-decoration: underline; }
  .model-head { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; overflow-wrap: anywhere; }
  .facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .25rem 1rem; margin: 0 0 .75rem; font-size: .8125rem; }
  .facts dt { color: var(--text-tertiary); } .facts dd { margin: 0; color: var(--text-secondary); overflow-wrap: anywhere; }
  .bar.wide { width: 8rem; display: inline-block; vertical-align: middle; }
  .setup { --fill: var(--surface); border-radius: var(--radius); padding: 1rem 1.125rem; text-align: left; margin-top: 1.25rem; }
  .page .setup { margin-top: 0; }
  .setup h2 { font-size: .9375rem; margin-bottom: .5rem; }
  .setup ol { margin: 0 0 .5rem; padding-left: 1.25rem; display: flex; flex-direction: column; gap: .625rem; }
  .setup li p { margin: 0 0 .25rem; color: var(--text); }
  .command { display: inline-block; background: var(--bg); border: 1px solid var(--border-strong); border-radius: .5rem; padding: .2rem .5rem; user-select: all; }

  @keyframes pulse { 50% { opacity: .35; } }
  @keyframes typing-dot { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }
  @keyframes message-in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) { *, ::before { animation: none !important; transition: none !important; } }

  .only-narrow { display: none; }
  @media (max-width: 1100px) {
    .panel:not([hidden]) { position: fixed; right: 0; top: 0; bottom: 0; z-index: 3; width: min(24rem, 92vw); }
  }
  @media (max-width: 760px) {
    .app { grid-template: "top" auto "main" minmax(0, 1fr) / minmax(0, 1fr); }
    .sidebar { position: fixed; inset: 0 auto 0 0; width: min(15rem, 85vw); z-index: 4; background: var(--bg); transform: translateX(-100%); transition: transform .2s; }
    .app.sidebar-open .sidebar { transform: none; }
    .only-narrow { display: inline-block; }
    .wide-only { display: none; }
    .cards { grid-template-columns: 1fr; }
    .card { margin-left: 0; }
  }
`;

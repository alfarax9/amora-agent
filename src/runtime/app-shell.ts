// The AMORA App's frame, which every page shares: the top bar with the
// runtime's state, the sidebar with the two session types, the two
// composers the scripts move between pages, and the dialogs. Static markup;
// the scripts fill it with text nodes only.

const icon = (path: string) =>
  `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

const icons = {
  chat: icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>'),
  code: icon('<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  artifact: icon('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>'),
  agency: icon(
    '<circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0"/><circle cx="4.5" cy="10" r="2"/><circle cx="19.5" cy="10" r="2"/>',
  ),
  settings: icon(
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  ),
  lock: icon(
    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  ),
  collapse: icon('<path d="M15 6l-6 6 6 6"/>'),
};

export const topbar = `<header class="topbar">
<ul class="status-list">
<li><button id="toggle-sidebar" type="button" class="secondary only-narrow" aria-label="Show navigation">☰</button></li>
<li>Orchestrator <span id="orchestrator-status" class="ok">OK</span></li>
<li id="gateway-item">Gateway <span id="gateway-status"></span></li>
</ul>
<div class="top-right">
<span id="budget-meter" class="budget wide-only"></span>
<button id="pause" type="button" class="secondary" hidden>Pause all workers</button>
</div>
</header>`;

// The mode switch offers exactly Chat and Octa Code; each remembers the last
// conversation open in it (shell.js).
export const sidebar = `<nav class="sidebar" id="sidebar" aria-label="AMORA">
<div class="brand">
<img class="brand-mark" src="/dashboard/mascots/nexus.svg" alt="">
<span class="brand-name">AMORA</span>
<button id="collapse" type="button" class="icon-button" aria-label="Collapse the sidebar" aria-pressed="false" title="Collapse the sidebar (⌘B)">${icons.collapse}</button>
</div>
<div class="modes" role="group" aria-label="Session type">
<a class="mode" id="mode-chat" data-mode="chat" href="/" title="Chat (⌘⇧M switches)">${icons.chat}<span>Chat</span></a>
<a class="mode" id="mode-code" data-mode="code" href="/code" title="Octa Code (⌘⇧M switches)">${icons.code}<span>Octa Code</span></a>
</div>
<a href="/" class="new-task for-chat" title="New chat (⌘⇧O)">${icons.plus}<span>New chat</span></a>
<a href="/code" id="new-task" class="new-task for-code">${icons.plus}<span>New session</span></a>
<div class="nav">
<button id="open-search" type="button" class="nav-item">${icons.search}<span>Search</span><kbd>⌘K</kbd></button>
<a class="nav-item for-chat" data-route="artifacts" href="/artifacts">${icons.artifact}<span>Artifacts</span></a>
<a class="nav-item" data-route="agency" href="/agency">${icons.agency}<span>Agency</span><span id="decision-count" class="count" hidden></span></a>
</div>
<div id="chat-list" class="recent for-chat"></div>
<div id="recent" class="recent for-code"></div>
<div class="sidebar-foot">
<p class="foot-line"><span id="foot-status" class="status" data-shape="idle"><span class="shape" aria-hidden="true"></span><span class="label">Runtime</span></span><span id="foot-spend" class="spend"></span></p>
<p class="foot-line meta" title="Reachable from this computer only">${icons.lock}<span id="address"></span></p>
<a class="nav-item" data-route="settings" href="/settings">${icons.settings}<span>Settings</span></a>
</div>
</nav>`;

// The Octa Code composer, which the script moves between the new-session page
// and a session's thread, so what the owner is typing survives every redraw.
export const codeComposer = `<div id="composer" class="composer-wrap" hidden>
<div class="composer">
<textarea id="brief" rows="1" aria-label="Message to the agency" placeholder="Message the agency"></textarea>
<button id="send" type="button" class="send" aria-label="Send" title="Send (Enter)">↑</button>
</div>
<div class="composer-row">
<button id="project-chip" type="button" class="project-chip" aria-haspopup="dialog" hidden>Choose a project</button>
<label id="budget-field" for="budget">Task budget $<input id="budget" type="number" min="0.01" step="0.01" value="1.00"></label>
<span id="composer-note"></span>
</div>
<p id="composer-error" class="error" role="alert"></p>
</div>`;

// Chat's composer: what the owner means (a question, work, or Auto), who
// answers (the agency, in A1), and the brain that will answer.
export const chatComposer = `<div id="chat-composer" class="composer-wrap" hidden>
<div class="composer chat-composer">
<textarea id="chat-input" rows="1" aria-label="Message" placeholder="Ask the agency or assign work…"></textarea>
<div class="composer-tools">
<label class="chip select-chip" for="chat-intent" title="Auto tells a question from work; you can say which it is"><span class="sr-only">Intent</span><select id="chat-intent"><option value="auto">Auto</option><option value="ask">Ask</option><option value="task">Assign task</option></select></label>
<span class="chip target-chip" title="Who answers: the agency">@ Agency</span>
<span id="chat-brain" class="brain"></span>
<button id="chat-send" type="button" class="send" aria-label="Send" title="Send (Enter)">↑</button>
</div>
</div>
<p id="chat-note" class="composer-row meta"></p>
<p id="chat-error" class="error" role="alert"></p>
</div>`;

export const dialogs = `<dialog id="project-picker" class="picker" aria-labelledby="picker-title"></dialog>
<dialog id="search-dialog" class="picker search-dialog" aria-labelledby="search-title"></dialog>
<p id="live" class="sr-only" aria-live="polite"></p>`;

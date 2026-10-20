function cookieNotice() {
  return `<aside><p>We use cookies</p><button type="button">Accept</button><button type="button">Decline</button></aside>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${cookieNotice()}${sections.join("")}</main>`;
}

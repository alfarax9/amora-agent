// The landing page, rendered to a string so it can be tested without a browser.
export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${sections.join("")}</main>`;
}

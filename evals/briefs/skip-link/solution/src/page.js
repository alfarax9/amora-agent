export function renderPage(sections = []) {
  return `<a href="#content">Skip to content</a><main id="content"><h1>Acme</h1>${sections.join("")}</main>`;
}

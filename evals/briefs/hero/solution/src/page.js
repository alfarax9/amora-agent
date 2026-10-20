function hero() {
  return `<section><h2>Ship faster</h2><p>Acme builds your landing page for you.</p><a href="/signup">Get started</a></section>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${hero()}${sections.join("")}</main>`;
}

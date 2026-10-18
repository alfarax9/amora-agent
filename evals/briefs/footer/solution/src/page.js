function footer(year) {
  const links = ["privacy", "terms", "contact"].map((page) => `<a href="/${page}">${page}</a>`);
  return `<footer><nav aria-label="Footer">${links.join("")}</nav><p>© ${year} Acme</p></footer>`;
}

export function renderPage(sections = [], { year = new Date().getFullYear() } = {}) {
  return `<main><h1>Acme</h1>${sections.join("")}</main>${footer(year)}`;
}

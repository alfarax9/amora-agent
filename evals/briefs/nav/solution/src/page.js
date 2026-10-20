function nav() {
  const links = [
    ["/", "Home"],
    ["/pricing", "Pricing"],
    ["/blog", "Blog"],
    ["/login", "Log in"],
  ];
  return `<nav aria-label="Main">${links.map(([href, text]) => `<a href="${href}">${text}</a>`).join("")}</nav>`;
}

export function renderPage(sections = []) {
  return `${nav()}<main><h1>Acme</h1>${sections.join("")}</main>`;
}

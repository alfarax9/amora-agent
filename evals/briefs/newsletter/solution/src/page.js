function signup() {
  return `<section><h2>Newsletter</h2><form><label for="email">Email</label><input id="email" type="email" name="email"><button type="submit">Subscribe</button></form></section>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${signup()}${sections.join("")}</main>`;
}

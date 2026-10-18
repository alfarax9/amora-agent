function contact() {
  const field = (name, label, control) => `<label for="${name}">${label}</label>${control}`;
  return `<form>${field("name", "Name", '<input id="name" name="name">')}${field("email", "Email", '<input id="email" name="email" type="email">')}${field("message", "Message", '<textarea id="message" name="message"></textarea>')}<button type="submit">Send</button></form>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${contact()}${sections.join("")}</main>`;
}

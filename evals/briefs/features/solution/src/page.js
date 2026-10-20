const features = [
  ["Fast", "Pages load in under a second."],
  ["Accessible", "Built to WCAG AA."],
  ["Tested", "Every change is checked."],
  ["Simple", "One file to edit."],
];

function features_() {
  const items = features.map(([title, text]) => `<li><h3>${title}</h3><p>${text}</p></li>`);
  return `<section><h2>Features</h2><ul>${items.join("")}</ul></section>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${features_()}${sections.join("")}</main>`;
}

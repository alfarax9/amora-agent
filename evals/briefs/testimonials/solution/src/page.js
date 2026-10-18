const quotes = [
  ["It saved us a week.", "Ana"],
  ["Simple and fast.", "Budi"],
  ["Our team loves it.", "Citra"],
];

function testimonials() {
  const items = quotes.map(
    ([quote, name]) => `<blockquote><p>${quote}</p><cite>${name}</cite></blockquote>`,
  );
  return `<section><h2>Testimonials</h2>${items.join("")}</section>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${testimonials()}${sections.join("")}</main>`;
}

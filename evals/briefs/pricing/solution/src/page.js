const plans = [
  ["Starter", "Free"],
  ["Team", "$12 per month"],
  ["Business", "$30 per month"],
];

function pricing() {
  const cards = plans.map(([name, price]) => `<li><h3>${name}</h3><p>${price}</p></li>`);
  return `<section aria-labelledby="pricing"><h2 id="pricing">Pricing</h2><ul>${cards.join("")}</ul></section>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${pricing()}${sections.join("")}</main>`;
}

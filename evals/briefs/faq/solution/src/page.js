const questions = [
  ["Is there a free plan?", "Yes, Starter is free."],
  ["Can I cancel?", "Yes, at any time."],
  ["Do you offer refunds?", "Within 30 days."],
];

function faq() {
  const items = questions.map(
    ([question, answer], index) =>
      `<li><button type="button" aria-expanded="false" aria-controls="faq-${index}">${question}</button><p id="faq-${index}" hidden>${answer}</p></li>`,
  );
  return `<section><h2>FAQ</h2><ul>${items.join("")}</ul></section>`;
}

export function renderPage(sections = []) {
  return `<main><h1>Acme</h1>${faq()}${sections.join("")}</main>`;
}

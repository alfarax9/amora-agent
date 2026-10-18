// Builds elements from text nodes only, so nothing a model or the owner wrote
// can ever run as HTML.

const isEmpty = (child) => child === null || child === undefined || child === false;

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "onclick") node.addEventListener("click", value);
    else if (!isEmpty(value)) node.setAttribute(name, String(value));
  }
  for (const child of children.flat().filter((item) => !isEmpty(item))) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export const usd = (amount) => `$${Number(amount).toFixed(2)}`;

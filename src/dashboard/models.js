import { el, usd } from "./dom.js";

// Models: the gateways with their keys masked, then every model a slot points
// at, with what each probe measured and when, what the registry says about
// it, and its price. A combo is measured member by member.

const capabilityNames = {
  vision: "Vision",
  tool_use: "Tool use",
  structured_output: "Structured output",
  context: "Context",
};

const day = (iso) => new Date(iso).toLocaleDateString();

function gatewayRow(gateway) {
  return el(
    "tr",
    {},
    el("td", { class: "strong" }, gateway.name),
    el(
      "td",
      { class: gateway.key ? "passed" : "waiting" },
      gateway.key ? "Connected" : "Not connected",
    ),
    el("td", {}, gateway.key ? el("code", {}, gateway.key) : "—"),
    el("td", { class: "wide-only" }, gateway.url ? el("code", {}, gateway.url) : "—"),
  );
}

function gateways(report) {
  const head = el(
    "tr",
    {},
    ["Gateway", "State", "Key", "Address"].map((name, index) =>
      el("th", { class: index === 3 ? "wide-only" : undefined }, name),
    ),
  );
  return el(
    "section",
    { class: "box" },
    el("h2", {}, "Gateways"),
    el("table", {}, el("thead", {}, head), el("tbody", {}, report.gateways.map(gatewayRow))),
    el(
      "p",
      { class: "meta" },
      "Keys stay in the keychain; only their last four characters are shown.",
    ),
  );
}

function probeRows(probes, member) {
  return probes.map((probe) =>
    el(
      "tr",
      {},
      member === undefined ? null : el("td", {}, el("code", {}, member)),
      el("td", {}, capabilityNames[probe.capability] ?? probe.capability),
      el("td", { class: "strong" }, probe.result),
      el("td", {}, probe.detail),
      el("td", { class: "right" }, day(probe.probedAt)),
    ),
  );
}

function probeTable(model) {
  const members = model.combo?.members;
  const rows = members
    ? members.flatMap(({ model: member, probes }) =>
        probes.length > 0
          ? probeRows(probes, member)
          : [
              el(
                "tr",
                {},
                el("td", {}, el("code", {}, member)),
                el("td", { class: "waiting", colspan: "4" }, "Not probed yet"),
              ),
            ],
      )
    : probeRows(model.probes);
  if (rows.length === 0) return el("p", { class: "meta" }, "Not probed on this machine.");
  const names = [members ? "Member" : null, "Capability", "Result", "Detail", "Probed"];
  const head = el(
    "tr",
    {},
    names.map((name) =>
      name ? el("th", { class: name === "Probed" ? "right" : undefined }, name) : null,
    ),
  );
  return el(
    "div",
    { class: "scroll" },
    el("table", {}, el("thead", {}, head), el("tbody", {}, rows)),
  );
}

function measured(model, maxAgeDays) {
  if (model.probedAt) {
    const stale = model.stale ? `, older than ${maxAgeDays} days (stale)` : "";
    return `Probed ${day(model.probedAt)}${stale}`;
  }
  if (model.registry) return `Measured by the registry on ${day(model.registry.probeDate)}`;
  const which = model.combo ? "Not every member is measured yet" : "Not measured yet";
  return `${which}: amora models probe ${model.model}`;
}

// A combo's family is each member's, so each member's is stated.
function unknownFamily(model) {
  const target = model.combo ? "<member>" : model.model;
  return `Unknown: amora models family ${target} <family>`;
}

function facts(model, maxAgeDays) {
  const price = model.price
    ? `${usd(model.price.inputPerMillion)} in, ${usd(model.price.outputPerMillion)} out per million tokens`
    : `No price known: amora models price ${model.model} <in> <out>`;
  const registry = model.registry
    ? `${model.registry.license}${model.registry.expires ? `, expires ${model.registry.expires}` : ""}`
    : "Not in the registry";
  return el(
    "dl",
    { class: "facts" },
    [
      ["Assigned to", model.assignedTo.join(", ")],
      ["Measured", measured(model, maxAgeDays)],
      ["Family", model.family?.join(", ") ?? unknownFamily(model)],
      ["Registry", registry],
      ["Price", price],
      model.combo
        ? ["Combo", `${model.combo.members.length} members, ${model.combo.strategy} routing`]
        : null,
    ]
      .filter(Boolean)
      .flatMap(([term, value]) => [el("dt", {}, term), el("dd", {}, value)]),
  );
}

function modelBox(model, maxAgeDays) {
  const [label, kind] = model.capabilities ? ["Experimental", "passed"] : ["Unverified", "waiting"];
  return el(
    "section",
    { class: "box" },
    el(
      "h2",
      { class: "model-head" },
      el("code", {}, model.model),
      el("span", { class: `chip ${kind}` }, label),
    ),
    facts(model, maxAgeDays),
    probeTable(model),
  );
}

export function renderModels(report) {
  const models =
    report.models.length > 0
      ? report.models.map((model) => modelBox(model, report.probeMaxAgeDays))
      : el(
          "p",
          { class: "empty-note" },
          "No model is assigned yet. Assign one with amora models set global <model>.",
        );
  return [gateways(report), models];
}

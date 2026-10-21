import { usd } from "./dom.js";

// Settings: the OpenRouter key's credit limit, read when the page opens and
// changed with a management key that is sent once and emptied from the field
// right away.

const shown = document.getElementById("credit-limit");
const amount = document.getElementById("limit-usd");
const reset = document.getElementById("limit-reset");
const managementKey = document.getElementById("management-key");
const save = document.getElementById("save-limit");
const error = document.getElementById("limit-error");

async function call(method, body) {
  let response;
  try {
    response = await fetch("/api/openrouter/limit", {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("The runtime is not answering. Is amora still running?");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The runtime could not do that. Check its log.");
  return data.limit;
}

function describe(limit) {
  if (limit.limitUsd === null) {
    return `Key ${limit.label} has no credit limit; spent ${usd(limit.usageUsd)} in all. OpenRouter only stops spending on this key once a limit is set.`;
  }
  const resets = limit.reset ? `resets ${limit.reset}` : "never resets";
  const left = limit.remainingUsd === null ? "" : `, ${usd(limit.remainingUsd)} left`;
  return `Key ${limit.label}: limit ${usd(limit.limitUsd)}, ${resets}${left}; spent today ${usd(limit.usageTodayUsd)}.`;
}

function show(limit) {
  shown.textContent = describe(limit);
  amount.value = limit.limitUsd === null ? "" : String(limit.limitUsd);
  reset.value = limit.reset ?? "";
}

async function load() {
  try {
    show(await call("GET"));
  } catch (failure) {
    shown.textContent = `The limit could not be read: ${failure.message}`;
  }
}

save?.addEventListener("click", async () => {
  error.textContent = "";
  const key = managementKey.value;
  managementKey.value = "";
  save.disabled = true;
  try {
    show(
      await call("POST", {
        limitUsd: amount.value.trim() === "" ? null : Number(amount.value),
        reset: reset.value === "" ? null : reset.value,
        managementKey: key,
      }),
    );
  } catch (failure) {
    error.textContent = failure.message;
  }
  save.disabled = false;
});

// Read each time Settings opens, so the figures are current.
const onSettings = () => globalThis.location.hash === "#settings";
globalThis.addEventListener("hashchange", () => {
  if (shown && onSettings()) void load();
});
if (shown && onSettings()) void load();

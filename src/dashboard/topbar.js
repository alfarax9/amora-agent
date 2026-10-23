import { el, usd } from "./dom.js";

// The top bar on every page: the address, the runtime's state, today's spend
// against the daily limit, and Pause all workers.

const $ = (id) => document.getElementById(id);

function meter(data) {
  if (data.dailyUsd === null) return [`Today ${usd(data.spentTodayUsd)}, no daily limit`];
  const percent = Math.min(100, Math.round((data.spentTodayUsd / data.dailyUsd) * 100));
  const bar = el(
    "span",
    { class: percent >= 100 ? "bar over" : "bar" },
    el("span", { style: `width: ${percent}%` }),
  );
  return ["Today", bar, el("b", {}, usd(data.spentTodayUsd)), `/ ${usd(data.dailyUsd)}`];
}

export function drawTopbar(data, app) {
  $("address").textContent = globalThis.location.host;
  const gateway = app.dataset.gateway === "connected";
  $("gateway-status").textContent = gateway ? "OK" : "Not connected";
  $("gateway-status").className = gateway ? "ok" : "off";
  $("orchestrator-status").textContent = data.paused ? "Paused" : "OK";
  $("orchestrator-status").className = data.paused ? "off" : "ok";
  $("budget-meter").replaceChildren(...meter(data));
  const pause = $("pause");
  pause.hidden = false;
  pause.textContent = data.paused ? "Resume all workers" : "Pause all workers";
}

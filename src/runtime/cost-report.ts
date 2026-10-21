import { priceOrNothing, type ReportDesk } from "./report-routes.ts";
import type { Storage } from "./storage.ts";
import { dayMs } from "./time.ts";

// The Costs page, from the handoffs table: spend per day, per worker, and per
// model over the last 30 days, and what a completed task cost. Every amount is
// what the gateway reported for the call. A gateway that reports no cost
// (OmniRoute, for one) leaves calls at $0, so for those the page shows an
// estimate from their tokens and the model's price, labelled as one.

const windowDays = 30;

type Spend = { usd: number; handoffs: number };

function perDay(storage: Storage, since: string) {
  return storage.database
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, SUM(cost_usd) AS usd, COUNT(*) AS handoffs
       FROM handoffs WHERE created_at >= ? GROUP BY day ORDER BY day DESC`,
    )
    .all(since) as (Spend & { day: string })[];
}

function perWorker(storage: Storage, since: string) {
  return storage.database
    .prepare(
      `SELECT sender AS worker, SUM(cost_usd) AS usd, COUNT(*) AS handoffs,
       SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut
       FROM handoffs WHERE created_at >= ? GROUP BY sender ORDER BY usd DESC, worker`,
    )
    .all(since) as (Spend & { worker: string; tokensIn: number; tokensOut: number })[];
}

type ModelRow = Spend & {
  model: string;
  tokensIn: number;
  tokensOut: number;
  unreported: number;
  unreportedIn: number;
  unreportedOut: number;
};

// Grouped by the model the slot named, which is the one with a price; a combo
// can answer with any member, and its price is its dearest member's.
function perModel(storage: Storage, since: string) {
  return storage.database
    .prepare(
      `SELECT model, SUM(cost_usd) AS usd, COUNT(*) AS handoffs,
       SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut,
       SUM(cost_usd = 0 AND tokens_in + tokens_out > 0) AS unreported,
       SUM(CASE WHEN cost_usd = 0 THEN tokens_in ELSE 0 END) AS unreportedIn,
       SUM(CASE WHEN cost_usd = 0 THEN tokens_out ELSE 0 END) AS unreportedOut
       FROM handoffs WHERE created_at >= ? GROUP BY model ORDER BY usd DESC, model`,
    )
    .all(since) as ModelRow[];
}

async function withEstimate(desk: ReportDesk, row: ModelRow) {
  const { unreportedIn, unreportedOut, ...rest } = row;
  if (row.unreported === 0) return { ...rest, estimatedUsd: null, priced: true };
  const price = await priceOrNothing(desk, row.model);
  if (!price) return { ...rest, estimatedUsd: null, priced: false };
  const usd =
    (unreportedIn * price.inputPerMillion) / 1e6 + (unreportedOut * price.outputPerMillion) / 1e6;
  return { ...rest, estimatedUsd: Math.round(usd * 1e6) / 1e6, priced: true };
}

// Completed tasks against all spend, failed and cancelled tasks included, and
// against what their plans were estimated to cost.
function completedTasks(storage: Storage, since: string) {
  const row = storage.database
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(spent_usd), 0) AS spentUsd,
       AVG(json_extract(plan, '$.estimate.usd')) AS estimatedUsd,
       COUNT(json_extract(plan, '$.estimate.usd')) AS estimated
       FROM tasks WHERE status = 'completed' AND created_at >= ?`,
    )
    .get(since) as {
    count: number;
    spentUsd: number;
    estimatedUsd: number | null;
    estimated: number;
  };
  const all = storage.database
    .prepare(
      "SELECT COALESCE(SUM(spent_usd), 0) AS usd, COUNT(*) AS count FROM tasks WHERE created_at >= ?",
    )
    .get(since) as { usd: number; count: number };
  return {
    completed: row.count,
    tasks: all.count,
    averageUsd: row.count > 0 ? row.spentUsd / row.count : null,
    allSpendPerCompletedUsd: row.count > 0 ? all.usd / row.count : null,
    estimatedAverageUsd: row.estimatedUsd,
    estimated: row.estimated,
  };
}

export async function costReport(desk: ReportDesk) {
  const { storage } = desk;
  // Today and the 29 days before it.
  const since = new Date(Date.now() - (windowDays - 1) * dayMs);
  since.setHours(0, 0, 0, 0);
  const from = since.toISOString();
  const models = await Promise.all(perModel(storage, from).map((row) => withEstimate(desk, row)));
  return {
    windowDays,
    since: from,
    dailyUsd: storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd ?? null,
    days: perDay(storage, from),
    workers: perWorker(storage, from),
    models,
    perTask: completedTasks(storage, from),
  };
}

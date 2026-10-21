import type { IncomingMessage } from "node:http";
import type { Registry } from "../model-layer/registry.ts";
import { costReport } from "./cost-report.ts";
import type { Price } from "./estimate.ts";
import type { WorkerManifest } from "./manifest-schema.ts";
import { modelReport } from "./model-report.ts";
import type { SecretStore } from "./secrets.ts";
import type { Storage } from "./storage.ts";
import type { JsonReply } from "./task-routes.ts";
import { workerReport } from "./worker-report.ts";

// The dashboard's read-only pages (dashboard PRD §6): the workers, the models
// they resolve to, and what the work cost. Nothing here changes anything; the
// CLI stays the place to assign models and set prices.

export type ReportDesk = {
  storage: Storage;
  secrets: SecretStore;
  manifests: WorkerManifest[];
  registry: Registry;
  // The price the agency estimates with, or nothing when nobody knows it.
  price(model: string): Promise<Price | undefined>;
};

type Report = (desk: ReportDesk) => Record<string, unknown> | Promise<Record<string, unknown>>;

const reports: Record<string, Report> = {
  "/api/workers": workerReport,
  "/api/models": modelReport,
  "/api/costs": costReport,
};

// Answers a report request, or nothing when the path is not one of these.
export async function handleReportApi(
  desk: ReportDesk,
  request: IncomingMessage,
  path: string,
): Promise<JsonReply | undefined> {
  const report = reports[path];
  if (!report || request.method !== "GET") return undefined;
  return { status: 200, body: await report(desk) };
}

// A price lookup can reach OpenRouter; a page that cannot get one says the
// price is unknown instead of failing.
export async function priceOrNothing(desk: ReportDesk, model: string): Promise<Price | null> {
  try {
    return (await desk.price(model)) ?? null;
  } catch {
    return null;
  }
}

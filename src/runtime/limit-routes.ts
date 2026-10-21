import type { IncomingMessage } from "node:http";
import type { Fetch } from "../model-layer/gateway.ts";
import {
  KeyLimitError,
  type LimitReset,
  limitResets,
  readKeyLimit,
  setKeyLimit,
} from "../model-layer/key-limit.ts";
import type { Logger } from "./logger.ts";
import { redactSecrets } from "./secret-scanner.ts";
import type { SecretStore } from "./secrets.ts";
import { BadRequest, type JsonReply, readJson } from "./task-routes.ts";

// The dashboard's settings for the OpenRouter key's own credit limit
// (key-limit.ts). The management key arrives in the request body, behind the
// session and Origin checks like every other API route, is used for the one
// change, and is never stored, logged, or sent back.

export type LimitDesk = { secrets: SecretStore; logger: Logger; fetchImpl?: Fetch };

const path = "/api/openrouter/limit";

async function openRouterKey(desk: LimitDesk): Promise<string> {
  const key = await desk.secrets.get("openrouter");
  if (!key) throw new BadRequest(409, "Connect OpenRouter first.");
  return key;
}

function limitOf(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw new BadRequest(400, "The limit must be an amount in USD above 0, or empty for none.");
}

function resetOf(value: unknown): LimitReset | null {
  if (value === null) return null;
  const reset = limitResets.find((name) => name === value);
  if (!reset) throw new BadRequest(400, "The reset must be daily, weekly, monthly, or never.");
  return reset;
}

function managementKeyOf(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 500) throw new BadRequest(400, "Enter an OpenRouter management key.");
  return key;
}

async function change(desk: LimitDesk, request: IncomingMessage): Promise<JsonReply> {
  const body = await readJson(request);
  const managementKey = managementKeyOf(body.managementKey);
  const wanted = { limitUsd: limitOf(body.limitUsd), reset: resetOf(body.reset) };
  const key = await openRouterKey(desk);
  const limit = await setKeyLimit(key, managementKey, wanted, desk.fetchImpl);
  desk.logger.info("OpenRouter key limit changed", {
    limitUsd: limit.limitUsd,
    reset: limit.reset,
  });
  return { status: 200, body: { limit } };
}

async function answer(desk: LimitDesk, request: IncomingMessage): Promise<JsonReply | undefined> {
  if (request.method === "GET") {
    return {
      status: 200,
      body: { limit: await readKeyLimit(await openRouterKey(desk), desk.fetchImpl) },
    };
  }
  return request.method === "POST" ? change(desk, request) : undefined;
}

// Answers a credit-limit request, or nothing when the path is not this one.
export async function handleLimitApi(
  desk: LimitDesk,
  request: IncomingMessage,
  pathname: string,
): Promise<JsonReply | undefined> {
  if (pathname !== path) return undefined;
  try {
    return await answer(desk, request);
  } catch (error) {
    if (error instanceof BadRequest)
      return { status: error.status, body: { error: error.message } };
    if (error instanceof KeyLimitError) return { status: 400, body: { error: error.message } };
    // OpenRouter's own message, which never carries the key, but is checked anyway.
    const reason = redactSecrets(error instanceof Error ? error.message : String(error));
    return { status: 502, body: { error: `OpenRouter could not do that: ${reason}` } };
  }
}

import { createHash, randomBytes } from "node:crypto";
import { GatewayError, type Fetch } from "./gateway.ts";

// OpenRouter's one-click connect (PRD §7.2): OAuth PKCE with a localhost
// callback, so the user approves AMORA on openrouter.ai and never copies a key.

const authorizeUrl = "https://openrouter.ai/auth";
const exchangeUrl = "https://openrouter.ai/api/v1/auth/keys";

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function authorizationUrl(options: {
  callbackUrl: string;
  verifier: string;
  state: string;
}): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set("callback_url", options.callbackUrl);
  url.searchParams.set("code_challenge", codeChallenge(options.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  url.searchParams.set("key_label", "AMORA");
  return url.toString();
}

export async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(exchangeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!response.ok) {
    throw new GatewayError(response.status, "OpenRouter did not accept the authorization code.");
  }
  const { key } = (await response.json()) as { key?: string };
  if (!key) throw new GatewayError(502, "OpenRouter returned no key.");
  return key;
}

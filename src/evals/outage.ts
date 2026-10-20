import { type Chat, GatewayError } from "../model-layer/gateway.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";

// A provider that cannot serve calls (out of quota or credit, a refused key,
// rate limits that outlast the retries, its own outage, an unreachable
// gateway) says nothing about the system under test. A run that ends on such a
// failure stops the benchmark instead of counting against the system.

const providerStatuses = [401, 402, 403, 429];

export function isProviderFailure(error: unknown): boolean {
  if (error instanceof GatewayError) {
    return providerStatuses.includes(error.status) || error.status >= 500;
  }
  // fetch says "fetch failed" when it cannot connect, and "terminated" when
  // the connection drops halfway through an answer.
  return error instanceof TypeError && /^(?:fetch failed|terminated)$/i.test(error.message);
}

// The provider failure that ended the latest call, if it ended on one; a later
// call that succeeds, such as a retry, clears it.
export type Watch = { failure: string | undefined };

export function watched(chat: Chat, watch: Watch): Chat {
  return async (request) => {
    try {
      const reply = await chat(request);
      watch.failure = undefined;
      return reply;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      watch.failure = isProviderFailure(error) ? redactSecrets(message) : undefined;
      throw error;
    }
  };
}

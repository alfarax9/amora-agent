import type { Chat } from "../model-layer/gateway.ts";

// Counts every model call a run makes, including ones that fail and ones the
// handoff log never records, so both systems are measured the same way.

export type Meter = { calls: number; tokensIn: number; tokensOut: number; costUsd: number };

export const emptyMeter = (): Meter => ({ calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });

export function metered(chat: Chat, meter: Meter): Chat {
  return async (request) => {
    meter.calls += 1;
    const reply = await chat(request);
    meter.tokensIn += reply.usage?.prompt_tokens ?? 0;
    meter.tokensOut += reply.usage?.completion_tokens ?? 0;
    meter.costUsd += reply.usage?.cost ?? 0;
    return reply;
  };
}

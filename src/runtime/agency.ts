import { familyProblem, type FamilyLookup } from "../model-layer/families.ts";
import type { Chat } from "../model-layer/gateway.ts";
import type { CapabilityLookup } from "../model-layer/known-models.ts";
import { resolveWorker, type SlotConfig } from "../model-layer/slots.ts";
import type { Contract } from "./contracts.ts";
import { type CheckOutcome, type CheckRunner, runGate } from "./gates.ts";
import type { WorkerManifest } from "./manifest-schema.ts";
import type { Storage } from "./storage.ts";
import { recordHandoff, type Task } from "./task-store.ts";
import { callWorker, type WorkerCall, type WorkerReply } from "./worker-runner.ts";

// Runs one worker's turn: finds its model through its slot, calls it, puts the
// answer through the worker's quality gate, and records every handoff,
// reviews included (PRD §6.2, §6.3).

export type Agency = {
  storage: Storage;
  manifests: WorkerManifest[];
  contracts: Contract[];
  readPrompt(manifest: WorkerManifest): string;
  slots(): SlotConfig;
  lookup: CapabilityLookup;
  families: FamilyLookup;
  // The chat function for a model id, and the name that gateway knows it by.
  connect(model: string): Promise<{ chat: Chat; name: string }>;
};

type Ready = { manifest: WorkerManifest; model: string; call: Omit<WorkerCall, "input"> };

async function prepare(agency: Agency, workerId: string): Promise<Ready | { problem: string }> {
  const manifest = agency.manifests.find((candidate) => candidate.id === workerId);
  if (!manifest) return { problem: `No worker is named "${workerId}".` };
  const resolution = resolveWorker(manifest, agency.slots(), agency.lookup);
  const capabilities = resolution.model ? agency.lookup(resolution.model) : undefined;
  if (resolution.verdict !== "fits" || !resolution.model || !capabilities) {
    return { problem: `${manifest.role} has no model that fits: ${resolution.problems.join(" ")}` };
  }
  const contract = agency.contracts.find(({ id }) => id === manifest.output_contract);
  if (!contract) return { problem: `The contract ${manifest.output_contract} is missing.` };
  const { chat, name } = await agency.connect(resolution.model);
  const prompt = agency.readPrompt(manifest);
  const structured = capabilities.structured_output;
  return {
    manifest,
    model: resolution.model,
    call: { chat, model: name, structured, prompt, contract },
  };
}

export type Turn = {
  task: Task;
  worker: string;
  input: unknown;
  receiver: string;
  attempt: number;
  check?: (output: unknown) => string[];
};

export type TurnOutcome = CheckOutcome & { output?: unknown; costUsd: number };

function blocked(reason: string): CheckOutcome {
  return { result: "blocked", reason, findings: [] };
}

function describe(outcome: CheckOutcome): string {
  return [outcome.reason, ...outcome.findings.map((finding) => `- ${finding}`)].join("\n");
}

function record(agency: Agency, turn: Turn, ready: Ready, reply: WorkerReply, gate: CheckOutcome) {
  recordHandoff(agency.storage, {
    taskId: turn.task.id,
    sender: ready.manifest.id,
    receiver: turn.receiver,
    contract: ready.call.contract.id,
    validation: reply.validation,
    gate: gate.result,
    gateReason: describe(gate),
    model: ready.model,
    answeredBy: reply.answeredBy,
    attempt: turn.attempt,
    tokensIn: reply.tokensIn,
    tokensOut: reply.tokensOut,
    costUsd: reply.costUsd,
    content: reply.output ?? null,
    artifacts: [],
  });
}

type Review = { verdict: "pass" | "fail"; findings: string[] };

// A reviewer marked ≠ is refused before it is called when its model family is
// the same as the reviewed worker's, or cannot be told apart from it.
async function review(
  agency: Agency,
  turn: Turn,
  worker: Ready,
  work: unknown,
  reviewerId: string,
  later: (() => void)[],
): Promise<CheckOutcome & { costUsd: number }> {
  const reviewer = await prepare(agency, reviewerId);
  if ("problem" in reviewer) return { ...blocked(reviewer.problem), costUsd: 0 };
  const { role } = reviewer.manifest;
  if (reviewer.call.contract.id !== "review.v1") {
    return { ...blocked(`${role} does not return review.v1, so it cannot review.`), costUsd: 0 };
  }
  if (reviewer.manifest.requires.reviewer_family_rule === "different") {
    const sides = [
      { role, model: reviewer.model },
      { role: worker.manifest.role, model: worker.model },
    ] as const;
    const problem = familyProblem(sides[0], sides[1], agency.families);
    if (problem) return { ...blocked(problem), costUsd: 0 };
  }
  const input = { request: turn.input, reviewing: worker.manifest.role, work };
  const reply = await callWorker({ ...reviewer.call, input });
  const verdict = reply.output as Review | undefined;
  const outcome: CheckOutcome = !verdict
    ? blocked(`${role}'s review did not match review.v1: ${reply.problems.join(" ")}`)
    : verdict.verdict === "pass"
      ? { result: "passed", reason: `${role} passed the work.`, findings: [] }
      : { result: "failed", reason: `${role} returned the work.`, findings: verdict.findings };
  // Written after the work it reviews, so the log reads in the order it happened.
  later.push(() =>
    record(agency, { ...turn, receiver: worker.manifest.id }, reviewer, reply, outcome),
  );
  return { ...outcome, costUsd: reply.costUsd };
}

export async function perform(agency: Agency, turn: Turn): Promise<TurnOutcome> {
  const ready = await prepare(agency, turn.worker);
  if ("problem" in ready) return { ...blocked(ready.problem), costUsd: 0 };
  const reply = await callWorker({
    ...ready.call,
    input: turn.input,
    ...(turn.check ? { check: turn.check } : {}),
  });
  let reviewCost = 0;
  const reviews: (() => void)[] = [];
  const runners: Record<string, CheckRunner> = {
    // callWorker has already held the output against its contract.
    schema_valid: async () => ({ result: "passed", reason: "", findings: [] }),
    reviewed_by: async (reviewerId) => {
      const outcome = await review(agency, turn, ready, reply.output, String(reviewerId), reviews);
      reviewCost += outcome.costUsd;
      return outcome;
    },
  };
  const gate: CheckOutcome =
    reply.validation === "invalid"
      ? {
          result: "failed",
          reason: `The output did not match ${ready.call.contract.id}.`,
          findings: reply.problems,
        }
      : await runGate(ready.manifest.quality_gate, runners);
  record(agency, turn, ready, reply, gate);
  for (const write of reviews) write();
  return { ...gate, output: reply.output, costUsd: reply.costUsd + reviewCost };
}

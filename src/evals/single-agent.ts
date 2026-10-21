import type { Chat } from "../model-layer/gateway.ts";
import type { StructuredOutput } from "../model-layer/registry.ts";
import type { Contract } from "../runtime/contracts.ts";
import { runGate } from "../runtime/gates.ts";
import type { WorkerManifest } from "../runtime/manifest-schema.ts";
import { matchesScope, projectGate } from "../runtime/project-gates.ts";
import { callWorker } from "../runtime/worker-runner.ts";
import { deliver, openWorkspace, projectView } from "../runtime/workspace.ts";

// The baseline of PRD §3: one strong agent with the same tools as AMORA's
// workers. Same model, same project checks (area, lint, typecheck, tests), same
// three attempts with the checks' output as feedback; no split into workers and
// no reviewer, which is the difference the benchmark measures.

export type SystemRun = { delivered: boolean; reason: string };

export type SingleAgent = {
  chat: Chat;
  model: string;
  structured: StructuredOutput;
  contract: Contract;
  prompt: string;
};

const area = ["src/**", "tests/**"];
const attempts = 3;

const agent: WorkerManifest = {
  id: "single-agent",
  division: "forge",
  wave: 1,
  role: "Single agent",
  mission: "Deliver the whole brief alone.",
  requires: {
    vision: false,
    tool_use: false,
    structured_output: false,
    min_context: 0,
    reviewer_family_rule: "none",
  },
  model_slot: "single-agent",
  prompt: "prompts/baseline/single-agent.md",
  plugins: area.map((scope) => ({ filesystem: { scope } })),
  memory: { project: true, global_patterns: false },
  input_contract: "brief.v1",
  output_contract: "code_change.v1",
  quality_gate: ["files_in_scope", "lint_and_typecheck_pass", "tests_pass"],
  permissions: { shell: ["npm"], network: false },
  budget: { max_usd_per_task: 1, max_retries: attempts },
};

export async function runSingleAgent(
  single: SingleAgent,
  brief: string,
  project: string,
  workspace: string,
): Promise<SystemRun> {
  openWorkspace(project, workspace);
  const inArea = (path: string) => area.some((scope) => matchesScope(path, scope));
  // The same code graph a step gets, focused on the brief alone.
  const view = { focus: { text: brief, paths: [] }, graphFile: `${workspace}.graph.sqlite` };
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const input = { brief, area, project: projectView(workspace, inArea, view), feedback };
    const reply = await callWorker({ ...single, input });
    if (reply.validation === "invalid") {
      feedback = [`The output did not match ${single.contract.id}.`, ...reply.problems];
      continue;
    }
    const gate = projectGate(workspace, agent, reply.output);
    const outcome = await runGate(agent.quality_gate, gate.runners);
    const written = gate.finish(outcome.result === "passed");
    if (outcome.result === "passed") {
      deliver(workspace, project, written);
      return { delivered: true, reason: `Passed its checks on attempt ${attempt}.` };
    }
    if (outcome.result === "blocked") return { delivered: false, reason: outcome.reason };
    feedback = [outcome.reason, ...outcome.findings];
  }
  // The last check's name and output, so a report can say what went wrong.
  const last = feedback.join(" ").replace(/\s+/g, " ").slice(0, 600);
  return { delivered: false, reason: `Did not pass its checks in ${attempts} attempts. ${last}` };
}

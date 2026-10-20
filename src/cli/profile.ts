import { rosterProfiles, rosterSettings } from "../runtime/roster.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

type RosterSetting = { profile: string };

// New tasks are weighed one by one unless the owner chooses a roster: a light
// brief gets the slim roster, which beat both the full roster and one agent on
// the benchmark's light briefs (docs/decisions.md, Oct 19, 2026), and a heavy
// one gets the specialists.
const defaultProfile = "auto";

export function rosterProfile(context: Pick<AppContext, "storage">): string {
  const chosen = context.storage.getSetting<RosterSetting>("roster")?.profile;
  return chosen !== undefined && rosterSettings.includes(chosen) ? chosen : defaultProfile;
}

function describe(context: AppContext, profile: string): string {
  if (profile === "auto") {
    return "New tasks are weighed one by one: a heavy brief (a whole product, a new screen to design, requirements to work out, an outside service, speed, or a lot to do) may use every worker; a light one uses the slim roster.";
  }
  const ids = rosterProfiles[profile];
  if (!ids) return `New tasks plan with the ${profile} roster: the Planner may use every worker.`;
  const roleOf = (id: string) =>
    context.manifests.find((manifest) => manifest.id === id)?.role ?? id;
  return `New tasks plan with the ${profile} roster: ${ids.map(roleOf).join(" and ")}, with the Reality Checker reviewing.`;
}

export function runRoster(context: AppContext, profile: string | undefined): boolean {
  if (profile !== undefined) {
    if (!rosterSettings.includes(profile)) {
      printError(`There is no ${profile} roster. Choose ${rosterSettings.join(", ")}.`);
      return false;
    }
    context.storage.setSetting("roster", { profile } satisfies RosterSetting);
  }
  print(describe(context, rosterProfile(context)));
  return true;
}

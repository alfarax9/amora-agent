import { rosterProfiles, rosterSettings, teamNames } from "../runtime/roster.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

type RosterSetting = { profile: string };

// New tasks are weighed one by one unless the owner chooses a team: a light
// brief gets the Small team, which beat both the Full team and one agent on
// the benchmark's light briefs (docs/decisions.md, Oct 19, 2026), and a heavy
// one gets the specialists.
const defaultProfile = "auto";

// Homes set up before the teams were named keep their choice.
const renamed: Record<string, string> = { slim: "small" };

export function rosterProfile(context: Pick<AppContext, "storage">): string {
  const stored = context.storage.getSetting<RosterSetting>("roster")?.profile;
  const chosen = stored === undefined ? undefined : (renamed[stored] ?? stored);
  return chosen !== undefined && rosterSettings.includes(chosen) ? chosen : defaultProfile;
}

function describe(context: AppContext, profile: string): string {
  if (profile === "auto") {
    return "New tasks are weighed one by one: a heavy brief (a whole product, a new screen to design, requirements to work out, an outside service, speed, or a lot to do) gets the Full team, every worker; a light one gets the Small team.";
  }
  const ids = rosterProfiles[profile];
  const team = teamNames[profile] ?? profile;
  if (!ids) return `New tasks plan with the ${team}: the Planner may use every worker.`;
  const roleOf = (id: string) =>
    context.manifests.find((manifest) => manifest.id === id)?.role ?? id;
  return `New tasks plan with the ${team}: ${ids.map(roleOf).join(" and ")}, with the Reality Checker reviewing.`;
}

export function runTeam(context: AppContext, profile: string | undefined): boolean {
  if (profile !== undefined) {
    if (!rosterSettings.includes(profile)) {
      printError(`There is no ${profile} team. Choose ${rosterSettings.join(", ")}.`);
      return false;
    }
    context.storage.setSetting("roster", { profile } satisfies RosterSetting);
  }
  print(describe(context, rosterProfile(context)));
  return true;
}

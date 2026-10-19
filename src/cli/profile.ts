import { rosterProfiles } from "../runtime/roster.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

type RosterSetting = { profile: string };

// New tasks plan with the slim roster unless the owner chooses otherwise: on
// the benchmark it beat both the full roster and one agent (docs/decisions.md,
// Oct 19, 2026).
const defaultProfile = "slim";

export function rosterProfile(context: Pick<AppContext, "storage">): string {
  const chosen = context.storage.getSetting<RosterSetting>("roster")?.profile;
  return chosen !== undefined && chosen in rosterProfiles ? chosen : defaultProfile;
}

function describe(context: AppContext, profile: string): string {
  const ids = rosterProfiles[profile];
  if (!ids) return `New tasks plan with the ${profile} roster: the Planner may use every worker.`;
  const roleOf = (id: string) =>
    context.manifests.find((manifest) => manifest.id === id)?.role ?? id;
  return `New tasks plan with the ${profile} roster: ${ids.map(roleOf).join(" and ")}, with the Reality Checker reviewing.`;
}

export function runRoster(context: AppContext, profile: string | undefined): boolean {
  if (profile !== undefined) {
    if (!(profile in rosterProfiles)) {
      printError(
        `There is no ${profile} roster. Choose ${Object.keys(rosterProfiles).join(" or ")}.`,
      );
      return false;
    }
    context.storage.setSetting("roster", { profile } satisfies RosterSetting);
  }
  print(describe(context, rosterProfile(context)));
  return true;
}

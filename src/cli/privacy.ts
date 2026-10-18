import type { AppContext } from "./context.ts";
import { print } from "./output.ts";

type Privacy = { openRouterDataCollection: "deny" | "allow" };

// S10: OpenRouter requests deny providers that keep or train on prompts,
// unless the owner allows it for this AMORA home. Most free models only have
// such providers (PRD §7.3, training notice), so free mode often needs it.
export function openRouterDataCollection(context: Pick<AppContext, "storage">): "deny" | "allow" {
  return context.storage.getSetting<Privacy>("privacy")?.openRouterDataCollection ?? "deny";
}

const notice = [
  "Providers that keep or train on prompts may now serve this AMORA home's OpenRouter requests.",
  "Those requests carry your briefs and your project's files. Allow this only for work you are",
  "willing to share, and turn it off with: amora privacy --deny-data-collection",
].join("\n");

export function runPrivacy(context: AppContext, choice: "allow" | "deny" | undefined): boolean {
  if (choice !== undefined) {
    context.storage.setSetting("privacy", { openRouterDataCollection: choice } satisfies Privacy);
  }
  const current = openRouterDataCollection(context);
  print(
    current === "allow"
      ? notice
      : "OpenRouter requests deny providers that keep or train on prompts (the default).",
  );
  return true;
}

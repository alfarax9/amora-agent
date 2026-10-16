import { GatewayError } from "../model-layer/gateway.ts";
import { readCombos } from "../model-layer/omniroute-combos.ts";
import { createOmniRoute, isLocalUrl } from "../model-layer/omniroute.ts";
import { maskSecret, redactSecrets } from "../runtime/secret-scanner.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";
import { readSecret } from "./secret-prompt.ts";

function isHttpUrl(text: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

async function printCombos(): Promise<void> {
  try {
    const combos = await readCombos();
    if (combos.length === 0) return print("No combos are set up in OmniRoute yet.");
    for (const combo of combos)
      print(`  combo omniroute:${combo.name} (${combo.members.length} members)`);
  } catch (error) {
    print(`Combos could not be listed: ${redactSecrets((error as Error).message)}`);
  }
}

// Only an answer from OmniRoute says anything about the key; a connection that
// never got an answer is a wrong address or a stopped server.
function connectFailure(url: string, error: unknown): string {
  const reason = redactSecrets(error instanceof Error ? error.message : String(error));
  if (!(error instanceof GatewayError)) return `Could not reach OmniRoute at ${url}: ${reason}`;
  if ([401, 403].includes(error.status))
    return `OmniRoute at ${url} did not accept the key: ${reason}`;
  return `OmniRoute at ${url} answered ${error.status}: ${reason}`;
}

// The key is typed at a hidden prompt, never passed as an argument (it would
// land in shell history) and never sent through chat (S4). It is checked
// against OmniRoute before anything is stored, so a typo changes nothing.
export async function connectOmniRoute(context: AppContext, url: string): Promise<boolean> {
  if (!isHttpUrl(url)) return (printError(`${url} is not an http or https address.`), false);
  if (!isLocalUrl(url)) {
    print(`Note: ${url} is not this machine. Your key and every prompt will go there.`);
  }
  const key = await readSecret("OmniRoute API key (typing is hidden): ");
  if (!key) return (printError("No key entered, so nothing changed."), false);
  let modelCount: number;
  try {
    modelCount = (await createOmniRoute(url, key).models()).length;
  } catch (error) {
    printError(connectFailure(url, error));
    printError("Nothing was stored.");
    return false;
  }
  await context.secrets.set("omniroute", key);
  context.storage.setSetting("omniroute", { url });
  print(`Connected to OmniRoute at ${url} (key ${maskSecret(key)}, ${modelCount} models).`);
  await printCombos();
  print("Probe a combo before assigning it, for example: amora models probe omniroute:<name>");
  print("Privacy: OmniRoute's own settings decide which providers see your prompts.");
  print("AMORA's data-collection default applies to OpenRouter only.");
  return true;
}

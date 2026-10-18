import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityLookup, type CapabilityLookup } from "../model-layer/known-models.ts";
import type { Registry } from "../model-layer/registry.ts";
import { type RegistrySource, selectRegistry } from "../model-layer/registry-source.ts";
import { emptySlots, type SlotConfig } from "../model-layer/slots.ts";
import { type Contract, loadContracts } from "../runtime/contracts.ts";
import type { WorkerManifest } from "../runtime/manifest-schema.ts";
import { loadManifests } from "../runtime/manifests.ts";
import { rosterProblems } from "../runtime/roster.ts";
import { keychainStore, type SecretStore } from "../runtime/secrets.ts";
import { dataDirectory, openStorage, type Storage } from "../runtime/storage.ts";

// Worker manifests and the registry ship inside the package, next to src/.
export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export const defaultPort = 4310;

export type AppContext = {
  storage: Storage;
  secrets: SecretStore;
  manifests: WorkerManifest[];
  contracts: Contract[];
  // Problems in workers/, contracts/, or prompts/, each naming its file.
  definitionErrors: string[];
  registry: Registry;
  registryErrors: string[];
  registrySource: RegistrySource["source"];
  registryCachePath: string;
  slots: SlotConfig;
  lookup: CapabilityLookup;
};

export function openContext(): AppContext {
  const storage = openStorage(join(dataDirectory(), "amora.db"));
  const { items: manifests, errors: manifestErrors } = loadManifests(join(packageRoot, "workers"));
  const { items: contracts, errors: contractErrors } = loadContracts(
    join(packageRoot, "contracts"),
  );
  const promptExists = (path: string) => existsSync(join(packageRoot, path));
  const definitionErrors = [
    ...manifestErrors,
    ...contractErrors,
    ...rosterProblems(manifests, contracts, promptExists),
  ];
  const registryCachePath = join(dataDirectory(), "registry.yaml");
  const {
    registry,
    errors: registryErrors,
    source: registrySource,
  } = selectRegistry(join(packageRoot, "registry", "models.yaml"), registryCachePath);
  return {
    storage,
    secrets: keychainStore(),
    manifests,
    contracts,
    definitionErrors,
    registry,
    registryErrors,
    registrySource,
    registryCachePath,
    slots: storage.getSetting<SlotConfig>("slots") ?? emptySlots,
    lookup: capabilityLookup(storage, registry),
  };
}

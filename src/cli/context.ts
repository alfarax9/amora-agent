import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityLookup, type CapabilityLookup } from "../model-layer/known-models.ts";
import type { Registry } from "../model-layer/registry.ts";
import { type RegistrySource, selectRegistry } from "../model-layer/registry-source.ts";
import { emptySlots, type SlotConfig } from "../model-layer/slots.ts";
import type { WorkerManifest } from "../runtime/manifest-schema.ts";
import { loadManifests } from "../runtime/manifests.ts";
import { keychainStore, type SecretStore } from "../runtime/secrets.ts";
import { dataDirectory, openStorage, type Storage } from "../runtime/storage.ts";

// Worker manifests and the registry ship inside the package, next to src/.
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export const defaultPort = 4310;

export type AppContext = {
  storage: Storage;
  secrets: SecretStore;
  manifests: WorkerManifest[];
  manifestErrors: string[];
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
    manifestErrors,
    registry,
    registryErrors,
    registrySource,
    registryCachePath,
    slots: storage.getSetting<SlotConfig>("slots") ?? emptySlots,
    lookup: capabilityLookup(storage, registry),
  };
}

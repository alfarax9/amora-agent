import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityLookup, type CapabilityLookup } from "../model-layer/known-models.ts";
import { loadRegistry, type Registry } from "../model-layer/registry.ts";
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
  slots: SlotConfig;
  lookup: CapabilityLookup;
};

export function openContext(): AppContext {
  const storage = openStorage(join(dataDirectory(), "amora.db"));
  const { items: manifests, errors: manifestErrors } = loadManifests(join(packageRoot, "workers"));
  const { registry, errors: registryErrors } = loadRegistry(
    join(packageRoot, "registry", "models.yaml"),
  );
  return {
    storage,
    secrets: keychainStore(),
    manifests,
    manifestErrors,
    registry,
    registryErrors,
    slots: storage.getSetting<SlotConfig>("slots") ?? emptySlots,
    lookup: capabilityLookup(storage, registry),
  };
}

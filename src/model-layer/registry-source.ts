import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fetch } from "./openrouter.ts";
import { loadRegistry, parseRegistry, type Registry } from "./registry.ts";

// The registry ships with each release and is also fetched while AMORA runs,
// so models that appear, disappear, or change price reach users between
// releases (PRD §7.5).
const registryUrl =
  "https://raw.githubusercontent.com/alfarax9/amora-agent/main/registry/models.yaml";
const timeoutMs = 5000;
const maxCharacters = 1_000_000;

export type RegistrySource = {
  registry: Registry;
  errors: string[];
  source: "bundled" | "fetched";
};

// The cached copy is used only when it is valid and newer than the one this
// release shipped with, so an old download never hides a newer release.
export function selectRegistry(bundledPath: string, cachePath: string): RegistrySource {
  const bundled = loadRegistry(bundledPath);
  if (!existsSync(cachePath)) return { ...bundled, source: "bundled" };
  const cached = loadRegistry(cachePath);
  const isNewer = cached.errors.length === 0 && cached.registry.version > bundled.registry.version;
  return isNewer ? { ...cached, source: "fetched" } : { ...bundled, source: "bundled" };
}

// Downloads the registry and caches it when it is newer than currentVersion.
// A failure leaves the cache alone: AMORA keeps running on what it has.
export async function refreshRegistry(
  cachePath: string,
  currentVersion: number,
  fetchImpl: Fetch = fetch,
): Promise<"updated" | "current"> {
  const response = await fetchImpl(registryUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`registry download failed with HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > maxCharacters) throw new Error("downloaded registry is too large");
  const { registry, errors } = parseRegistry(text);
  if (errors.length > 0) throw new Error(`downloaded registry is invalid: ${errors[0]}`);
  if (registry.version <= currentVersion) return "current";
  // Written beside the cache and renamed, so a crash never leaves half a file.
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(`${cachePath}.tmp`, text);
  renameSync(`${cachePath}.tmp`, cachePath);
  return "updated";
}

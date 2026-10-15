import { AsyncEntry } from "@napi-rs/keyring";

// Secrets live in the OS keychain (S4): Keychain on macOS, Credential Manager
// on Windows, Secret Service on Linux. Nothing else in AMORA stores them.
type SecretName = "openrouter";

export type SecretStore = {
  get(name: SecretName): Promise<string | undefined>;
  set(name: SecretName, value: string): Promise<void>;
};

const service = "amora";

export function keychainStore(): SecretStore {
  const entry = (name: SecretName) => new AsyncEntry(service, name);
  return {
    get: (name) => entry(name).getPassword(),
    set: (name, value) => entry(name).setPassword(value),
  };
}

// Used by tests, so they never touch the real keychain.
export function memoryStore(): SecretStore {
  const values = new Map<SecretName, string>();
  return {
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
  };
}

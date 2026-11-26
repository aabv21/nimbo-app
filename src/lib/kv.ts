import Storage from 'expo-sqlite/kv-store';

/** The app's only `expo-sqlite/kv-store` caller: small on-device values go through these. */

export function kvGet(key: string): string | null {
  return Storage.getItemSync(key);
}

/** `raw` parsed as JSON when it passes `guard`; null when absent, unreadable or of another shape. */
export function parseJson<T>(raw: string | null, guard: (value: unknown) => value is T): T | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return guard(value) ? value : null;
}

/** The value stored under `key`, read like `parseJson`. */
export function kvGetJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  return parseJson(kvGet(key), guard);
}

export function kvSet(key: string, value: string): void {
  Storage.setItemSync(key, value);
}

export function kvRemove(key: string): void {
  Storage.removeItemSync(key);
}

/** Every key in the store. */
export function kvKeys(): string[] {
  return Storage.getAllKeysSync();
}

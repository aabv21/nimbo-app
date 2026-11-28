// Mapped over `expo-sqlite/kv-store` for the `integration` project (docs/testing.md#integration):
// the real one is native, so the profile cache runs on an in-memory map with the same sync API.
const store = new Map<string, string>();

export default {
  getItemSync: (key: string): string | null => store.get(key) ?? null,
  setItemSync: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItemSync: (key: string): void => {
    store.delete(key);
  },
};

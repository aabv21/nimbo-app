// Short refs stand in for row ids in everything the model sees; only the server maps them back, per request.

/** e episode, m medication, r a get_episodes result, p a crisis-plan entry, o an overuse count, d a draft, n a note, i an insight, s a signal. */
export type RefPrefix = 'e' | 'm' | 'r' | 'p' | 'o' | 'd' | 'n' | 'i' | 's';

export type Refs = {
  /** The ref for `id`, minting the next one for its prefix (`e1`, `e2`, …) the first time. */
  add(prefix: RefPrefix, id: string): string;
  /** The id behind a ref minted in this request; null for anything else. */
  idOf(ref: string): string | null;
};

export function createRefs(): Refs {
  const byRef = new Map<string, string>();
  const byId = new Map<string, string>();
  const counts = new Map<RefPrefix, number>();
  return {
    add(prefix, id) {
      const key = `${prefix}:${id}`;
      const known = byId.get(key);
      if (known !== undefined) return known;
      const next = (counts.get(prefix) ?? 0) + 1;
      counts.set(prefix, next);
      const ref = `${prefix}${String(next)}`;
      byRef.set(ref, id);
      byId.set(key, ref);
      return ref;
    },
    idOf: (ref) => byRef.get(ref) ?? null,
  };
}

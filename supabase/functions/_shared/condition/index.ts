import { migraine } from './migraine.ts';
import type { CatalogItem, CatalogName, ConditionPack } from './types.ts';

export type { CatalogItem, CatalogName, ConditionPack, Locale, MedicationClass } from './types.ts';

export const packs: Readonly<Record<'migraine', ConditionPack>> = Object.freeze({ migraine });

export function catalogKeys(pack: ConditionPack, catalog: CatalogName): readonly string[] {
  return Object.entries(pack).flatMap(([name, value]) =>
    name === catalog ? (value as readonly CatalogItem[]).map((item) => item.key) : [],
  );
}

import { migraine } from './migraine.ts';
import type { CatalogItem, CatalogName, ConditionPack } from './types.ts';

export type { CatalogItem, CatalogName, ConditionPack, Locale, MedicationClass, RedFlag, RedFlagKey } from './types.ts';
export { MAX_AHEAD_MS } from './clock.ts';
export { crisisPlan } from './crisisPlan.ts';
export type { PlanDose, PlanEntry, PlanEpisode } from './crisisPlan.ts';
export { daysLeftInMonth, doseDaysForMonth, localDateIn } from './doseDays.ts';
export { emergencyNumber, emergencyRegions } from './emergency.ts';
export { overuseStatus } from './overuse.ts';
export type { OveruseEntry, OveruseLevel, OveruseStatus } from './overuse.ts';
export { matchRedFlags, matchRedFlagsAnyLocale, normalizeText } from './redFlags.ts';

export const packs: Readonly<Record<'migraine', ConditionPack>> = Object.freeze({ migraine });

export function catalogKeys(pack: ConditionPack, catalog: CatalogName): readonly string[] {
  return Object.entries(pack).flatMap(([name, value]) =>
    name === catalog ? (value as readonly CatalogItem[]).map((item) => item.key) : [],
  );
}

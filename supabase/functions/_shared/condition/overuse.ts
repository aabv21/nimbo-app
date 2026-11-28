// Medication-overuse guard: pure, so the phone and any Edge Function count the same way.
import type { ConditionPack, MedicationClass } from './types.ts';

export type OveruseLevel = 'ok' | 'warn' | 'limit';

export interface OveruseEntry {
  readonly days: number;
  /** Null when the class has no tracked limit. */
  readonly limit: number | null;
  readonly level: OveruseLevel;
}

export interface OveruseStatus {
  readonly byClass: Record<MedicationClass, OveruseEntry>;
  /** ICHD-3 8.2.6: the `pack.combinedClasses` together, none individually overused; above `ok` only with two or more of them. */
  readonly combined: OveruseEntry & { readonly classes: readonly MedicationClass[] };
}

function levelOf(days: number, limit: number | null, warnRatio: number): OveruseLevel {
  if (limit === null) return 'ok';
  if (days >= limit) return 'limit';
  return days / limit >= warnRatio ? 'warn' : 'ok';
}

/** `doseDays`: the local dates (`YYYY-MM-DD`) with an acute dose, per class, in one calendar month. */
export function overuseStatus(
  doseDays: Readonly<Partial<Record<MedicationClass, readonly string[]>>>,
  pack: ConditionPack,
): OveruseStatus {
  const byClass = {} as Record<MedicationClass, OveruseEntry>;
  const tracked: MedicationClass[] = [];
  const distinct = new Set<string>();

  for (const medicationClass of pack.medicationClasses) {
    const dates = new Set(doseDays[medicationClass] ?? []);
    const limit = pack.overuseDayLimits[medicationClass];
    byClass[medicationClass] = { days: dates.size, limit, level: levelOf(dates.size, limit, pack.overuseWarnRatio) };
    if (pack.combinedClasses.includes(medicationClass) && dates.size > 0) {
      tracked.push(medicationClass);
      for (const date of dates) distinct.add(date);
    }
  }

  const limit = pack.combinedClassDayLimit;
  const level = tracked.length >= 2 ? levelOf(distinct.size, limit, pack.overuseWarnRatio) : 'ok';
  return { byClass, combined: { days: distinct.size, limit, level, classes: tracked } };
}

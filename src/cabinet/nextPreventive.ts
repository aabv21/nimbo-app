// The preventive dose still due today, for Today's medication card.
import { localDateIn } from './doseDays';
import type { Medication } from './medicationStore';
import { nextOccurrences } from './reminders';

/** The earliest scheduled preventive dose after `now` on the same local day; null when none is left today. */
export function nextPreventive(
  meds: readonly Medication[],
  now: Date,
  timeZone: string,
): { medication: Medication; at: Date } | null {
  const today = localDateIn(now, timeZone);
  let best: { medication: Medication; at: Date } | null = null;
  for (const medication of meds) {
    if (medication.kind !== 'preventive' || medication.archived) continue;
    const at = nextOccurrences(medication, now, 1, timeZone)[0];
    if (at === undefined || localDateIn(at, timeZone) !== today) continue;
    if (best === null || at.getTime() < best.at.getTime()) best = { medication, at };
  }
  return best;
}

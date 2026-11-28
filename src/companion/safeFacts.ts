// The facts a replaced dose answer may still show: what the user logged and the interval they entered, never advice.
import type { Dose } from '../cabinet/doseStore';
import type { Medication } from '../cabinet/medicationStore';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The latest acute dose of the last 24 h whose medication has an interval; null when there is none. */
export function safeFacts(doses: readonly Dose[], meds: readonly Medication[], now: Date): { med: string; time: Date; hours: number } | null {
  const byId = new Map(meds.map((med) => [med.id, med]));
  let best: { med: Medication; time: Date } | null = null;
  for (const dose of doses) {
    const med = byId.get(dose.medicationId);
    if (med === undefined || med.kind !== 'acute' || med.minIntervalMinutes === null) continue;
    const time = new Date(dose.takenAt);
    // A dose logged after `now` (the reply's time) was not there when the reply was replaced.
    const age = now.getTime() - time.getTime();
    if (age < 0 || age > DAY_MS) continue;
    if (best === null || time > best.time) best = { med, time };
  }
  if (best === null || best.med.minIntervalMinutes === null) return null;
  return { med: best.med.name, time: best.time, hours: best.med.minIntervalMinutes / 60 };
}

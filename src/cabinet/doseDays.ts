// Counts days with an acute dose per medication class, in the local calendar the user lives by.
import type { MedicationClass } from '../condition';
import type { Dose } from './doseStore';
import type { Medication } from './medicationStore';

const formats = new Map<string, Intl.DateTimeFormat>();

function partsOf(date: Date, timeZone: string): { year: number; month: number; day: number } {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    formats.set(timeZone, format);
  }
  const part = (type: string): number => Number(format.formatToParts(date).find((entry) => entry.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM-DD` of `date` in `timeZone`; the device's own zone is `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
export function localDateIn(date: Date, timeZone: string): string {
  const { year, month, day } = partsOf(date, timeZone);
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/**
 * Distinct local dates with an acute dose, per class, in the calendar month `month` falls in. Doses of
 * archived medications count; doses of a medication not on the phone, and preventive ones, do not.
 */
export function doseDaysForMonth(
  doses: readonly Dose[],
  medications: readonly Medication[],
  month: Date,
  timeZone: string,
): Partial<Record<MedicationClass, readonly string[]>> {
  const prefix = localDateIn(month, timeZone).slice(0, 8);
  const classOf = new Map(medications.filter((med) => med.kind === 'acute').map((med) => [med.id, med.medicationClass]));
  const days = new Map<MedicationClass, Set<string>>();
  for (const dose of doses) {
    const medicationClass = classOf.get(dose.medicationId);
    if (medicationClass === undefined) continue;
    const date = localDateIn(new Date(dose.takenAt), timeZone);
    if (!date.startsWith(prefix)) continue;
    const set = days.get(medicationClass) ?? new Set<string>();
    set.add(date);
    days.set(medicationClass, set);
  }
  const result: Partial<Record<MedicationClass, readonly string[]>> = {};
  for (const [medicationClass, set] of days) result[medicationClass] = [...set].sort();
  return result;
}

/** Whole days after today in the month; 0 on its last day. */
export function daysLeftInMonth(now: Date, timeZone: string): number {
  const { year, month, day } = partsOf(now, timeZone);
  return new Date(Date.UTC(year, month, 0)).getUTCDate() - day;
}

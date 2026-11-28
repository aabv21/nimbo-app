// Local calendar maths for the insights and signals: dates are `YYYY-MM-DD` strings in the user's zone.
import type { Weekday } from './condition/types.ts';
import { localDateIn } from './condition/doseDays.ts';

const hourFormats = new Map<string, Intl.DateTimeFormat>();

/** The local hour (0–23) of `instant` in `timeZone`. */
export function localHourIn(instant: Date, timeZone: string): number {
  let format = hourFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    hourFormats.set(timeZone, format);
  }
  return Number(format.formatToParts(instant).find((part) => part.type === 'hour')?.value);
}

/** The local date a record belongs to: before `dayStartHour` it is still the previous day's night. */
export function recordDayOf(instant: Date, timeZone: string, dayStartHour: number): string {
  const date = localDateIn(instant, timeZone);
  return localHourIn(instant, timeZone) < dayStartHour ? addDays(date, -1) : date;
}

const utcOf = (localDate: string): number => Date.parse(`${localDate}T00:00:00Z`);

export function addDays(localDate: string, days: number): string {
  return new Date(utcOf(localDate) + days * 86_400_000).toISOString().slice(0, 10);
}

/** `to` − `from` in whole days. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / 86_400_000);
}

const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function weekdayOf(localDate: string): Weekday {
  return WEEKDAYS[new Date(utcOf(localDate)).getUTCDay()] ?? 'sun';
}

export function daysInMonth(localMonth: string): number {
  const [year, month] = localMonth.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, month ?? 1, 0)).getUTCDate();
}

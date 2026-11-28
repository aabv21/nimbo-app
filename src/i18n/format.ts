// Times and durations shown to the user, computed here rather than by `Intl` so every engine agrees.
import type { Locale } from '../condition';

const pad = (value: number): string => String(value).padStart(2, '0');

/** "3:55 PM" in English, "15:55" in Spanish and Portuguese. */
export function formatClock(date: Date, locale: Locale): string {
  const hours = date.getHours();
  const minutes = pad(date.getMinutes());
  if (locale === 'en') {
    return `${String(hours % 12 === 0 ? 12 : hours % 12)}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
  }
  return `${pad(hours)}:${minutes}`;
}

/** Whole minutes as "45 min", "5 h 20 min" or, from a day on, "3 d 2 h" (minutes dropped). */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return hours > 0 ? `${String(days)} d ${String(hours)} h` : `${String(days)} d`;
  if (hours > 0) return rest > 0 ? `${String(hours)} h ${String(rest)} min` : `${String(hours)} h`;
  return `${String(rest)} min`;
}

/** A typed time, "22:10" or "7:05"; null for anything that is not a valid 24-hour clock time. */
export function parseClock(text: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

// Dates as the user reads them, from `Intl` in the app's language; the clock times come from `formatClock`.
import type { Locale } from '../condition';
import { formatClock } from '../i18n/format';

const dayFormats = new Map<Locale, Intl.DateTimeFormat>();
const monthFormats = new Map<Locale, Intl.DateTimeFormat>();
const stampFormats = new Map<Locale, Intl.DateTimeFormat>();

function cached(cache: Map<Locale, Intl.DateTimeFormat>, locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let format = cache.get(locale);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, options);
    cache.set(locale, format);
  }
  return format;
}

const upperFirst = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** "Wednesday, November 25". */
export function dayTitle(date: Date, locale: Locale): string {
  return upperFirst(cached(dayFormats, locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(date));
}

/** "November 2026". */
export function monthTitle(year: number, month: number, locale: Locale): string {
  return upperFirst(cached(monthFormats, locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)));
}

/** "Sun, Nov 22, 3:40 PM": a date and time in one line, for the editor's fields. */
export function stamp(date: Date, locale: Locale): string {
  const day = cached(stampFormats, locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  return `${upperFirst(day)}, ${formatClock(date, locale)}`;
}

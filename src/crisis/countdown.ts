// Dose countdowns and typed dose times, computed in code from the interval the user entered.
const MINUTE_MS = 60 * 1000;

/** When the next dose is possible; null without a dose or without an interval (no countdown then). */
export function nextDoseAt(lastTakenAt: Date | null, minIntervalMinutes: number | null): Date | null {
  if (lastTakenAt === null || minIntervalMinutes === null) return null;
  return new Date(lastTakenAt.getTime() + minIntervalMinutes * MINUTE_MS);
}

/** Whole minutes until `next`, a part minute counted as one, never below 0. */
export function minutesLeft(next: Date, now: Date): number {
  return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / MINUTE_MS));
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatIn(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** The wall clock of `instant` in `timeZone`, written as if it were UTC. */
function wallClockMs(instant: number, timeZone: string): number {
  const parts = formatIn(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
}

/** The instant whose wall clock in `timeZone` reads `wall`; the offset is read twice to settle across a DST change. */
function instantOf(wall: number, timeZone: string): number {
  const first = wall - (wallClockMs(wall, timeZone) - wall);
  return wall - (wallClockMs(first, timeZone) - first);
}

/**
 * The instant of a typed clock time on today's date in `timeZone`. A time later than `now` cannot have
 * happened yet, so it is yesterday's: "23:50" typed at 00:10 is ten past eleven last night.
 */
export function resolveDoseTime(clock: { hours: number; minutes: number }, now: Date, timeZone: string): Date {
  const today = new Date(wallClockMs(now.getTime(), timeZone));
  const wall = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), clock.hours, clock.minutes);
  const todays = instantOf(wall, timeZone);
  if (todays <= now.getTime()) return new Date(todays);
  return new Date(instantOf(wall - 24 * 60 * MINUTE_MS, timeZone));
}

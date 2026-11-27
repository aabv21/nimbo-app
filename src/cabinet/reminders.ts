// Local reminders for preventive medications, scheduled on the phone with no server (pattern: a daily local notification).
// Privacy: the text is neutral unless the user turned on the lock-screen detail, and `data` carries nothing.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translate } from '../i18n';
import type { Locale } from '../i18n';
import type { Medication } from './medicationStore';

export const REMINDER_CHANNEL_ID = 'preventive-reminders';

const ID_PREFIX = 'preventive-reminder:';
/** How many one-time notifications a monthly or quarterly schedule keeps queued ahead. */
const DATE_REMINDERS = 3;

type Schedule = Pick<Medication, 'schedule' | 'scheduleTime' | 'scheduleAnchor'>;

// Every sync runs after the previous one, so two quick changes can't interleave their cancel and schedule steps.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

// --- Wall-clock time in a named zone (Hermes has `Intl.DateTimeFormat` but nothing that goes the other way) ---

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function wallOf(instant: Date, timeZone: string): Wall {
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
  const parts = format.formatToParts(instant);
  const part = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

const MINUTE_MS = 60_000;

function offsetAt(instantMs: number, timeZone: string): number {
  const minuteStart = Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
  const wall = wallOf(new Date(minuteStart), timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - minuteStart;
}

/** The instant at which the wall clock in `timeZone` reads this date and time; `month` and `day` may overflow. */
function instantAt(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes: the offset at the first guess may belong to the other side of a daylight-saving change.
  const first = asUtc - offsetAt(asUtc, timeZone);
  return new Date(asUtc - offsetAt(first, timeZone));
}

function clockOf(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match === null ? null : { hour: Number(match[1]), minute: Number(match[2]) };
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The next `count` times the schedule is due after `from`, with the wall clock read in `timeZone`.
 * A monthly or quarterly anchor on the 31st falls on the last day of shorter months.
 */
export function nextOccurrences(med: Schedule, from: Date, count: number, timeZone: string): Date[] {
  if (med.schedule === null || med.scheduleTime === null) return [];
  const clock = clockOf(med.scheduleTime);
  if (clock === null) return [];
  const now = wallOf(from, timeZone);
  const found: Date[] = [];

  if (med.schedule === 'daily') {
    for (let offset = 0; found.length < count; offset += 1) {
      const at = instantAt(now.year, now.month, now.day + offset, clock.hour, clock.minute, timeZone);
      if (at.getTime() > from.getTime()) found.push(at);
    }
    return found;
  }

  const anchor = med.scheduleAnchor === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(med.scheduleAnchor);
  if (anchor === null) return [];
  const step = med.schedule === 'monthly' ? 1 : 3;
  const anchorIndex = Number(anchor[1]) * 12 + Number(anchor[2]) - 1;
  const nowIndex = now.year * 12 + now.month - 1;
  const skipped = nowIndex > anchorIndex ? Math.floor((nowIndex - anchorIndex) / step) : 0;
  for (let index = anchorIndex + skipped * step; found.length < count; index += step) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const day = Math.min(Number(anchor[3]), daysInMonth(year, month));
    const at = instantAt(year, month, day, clock.hour, clock.minute, timeZone);
    if (at.getTime() > from.getTime()) found.push(at);
  }
  return found;
}

// --- Notifications ---

async function ensureChannel(locale: Locale): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: translate(locale, 'reminder.channel'),
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

function allowed(status: Notifications.NotificationPermissionsStatus): boolean {
  return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

const grantListeners = new Set<() => void>();

/** Calls `listener` whenever `askNotificationPermission` finds the permission granted; returns the unsubscribe. */
export function onPermissionGranted(listener: () => void): () => void {
  grantListeners.add(listener);
  return () => {
    grantListeners.delete(listener);
  };
}

/**
 * Asks only when the system still can; a permanent denial is left to Settings. The channel comes first:
 * Android 13 shows no prompt without one.
 */
export async function askNotificationPermission(locale: Locale = 'en'): Promise<boolean> {
  await ensureChannel(locale);
  const current = await Notifications.getPermissionsAsync();
  let granted = allowed(current);
  if (!granted && current.canAskAgain) {
    granted = allowed(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  }
  // The sync that the saved schedule triggered ran before this answer and scheduled nothing: tell it to run again.
  if (granted) for (const listener of grantListeners) listener();
  return granted;
}

async function cancelAll(): Promise<void> {
  let scheduled: Notifications.NotificationRequest[] = [];
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    // The OS can't list them: the schedule below replaces them by identifier.
  }
  for (const entry of scheduled) {
    if (!entry.identifier.startsWith(ID_PREFIX)) continue;
    try {
      await Notifications.cancelScheduledNotificationAsync(entry.identifier);
    } catch {
      // Already delivered or gone: nothing left to cancel.
    }
  }
}

/** Cancels every preventive reminder, for a session that ended. */
export function clearReminders(): Promise<void> {
  return serial(cancelAll);
}

/**
 * Makes the OS hold exactly the reminders these medications call for: it cancels all of the app's, then schedules
 * a `DAILY` trigger per daily medication and `DATE` triggers for the next three monthly or quarterly doses.
 * Archived and acute medications get none, and with no permission nothing is scheduled.
 */
export function syncReminders(
  userId: string,
  meds: readonly Medication[],
  options: { detail: boolean; locale: Locale },
): Promise<void> {
  return serial(async () => {
    await cancelAll();
    if (!allowed(await Notifications.getPermissionsAsync())) return;
    const due = meds.filter((med) => med.kind === 'preventive' && !med.archived && med.schedule !== null);
    if (due.length === 0) return;
    await ensureChannel(options.locale);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    for (const med of due) {
      const clock = med.scheduleTime === null ? null : clockOf(med.scheduleTime);
      if (clock === null) continue;
      const content = {
        title: 'Nimbo',
        body: options.detail ? translate(options.locale, 'reminder.detail', { med: med.name }) : translate(options.locale, 'push.neutral'),
      };
      const identifier = (n: number): string => `${ID_PREFIX}${userId}:${med.id}:${String(n)}`;
      if (med.schedule === 'daily') {
        await Notifications.scheduleNotificationAsync({
          identifier: identifier(0),
          content,
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: clock.hour, minute: clock.minute, channelId: REMINDER_CHANNEL_ID },
        });
        continue;
      }
      const dates = nextOccurrences(med, now, DATE_REMINDERS, timeZone);
      for (const [n, date] of dates.entries()) {
        await Notifications.scheduleNotificationAsync({
          identifier: identifier(n),
          content,
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: REMINDER_CHANNEL_ID },
        });
      }
    }
  });
}

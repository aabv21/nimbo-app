// The six signal rules and the push decision: pure and synchronous, so the phone, the companion and the hourly
// monitor compute the same rows and the caller owns every read (docs/architecture.md#signals-and-the-pressure-forecast).
import { doseDaysForMonth, localDateIn } from './condition/doseDays.ts';
import { overuseStatus } from './condition/overuse.ts';
import type { ConditionPack, MedicationClass, SignalKind, SleepBand } from './condition/types.ts';
import { isRecord } from './guards.ts';
import { addDays, daysBetween, recordDayOf } from './localDays.ts';
import type { RecordCheckin, RecordEpisode, Records } from './records.ts';
import type { PressureForecast } from './weather.ts';

export type { SignalKind };

export type Signal =
  | { kind: 'pressure'; cause: 'pressure'; causeKey: string; evidence: { nowHpa: number; laterHpa: number; laterAt: string; dropHpa: number } }
  | {
      kind: 'short_sleep';
      cause: 'short_sleep';
      causeKey: string;
      evidence: { sleepBand: SleepBand; avgAttackNightHours: number; attackNights: number; avgOtherNightHours: number };
    }
  | {
      kind: 'overuse_warn' | 'overuse_limit';
      cause: `overuse:${string}`;
      causeKey: string;
      evidence: { scope: MedicationClass | 'combined'; days: number; limit: number; level: 'warn' | 'limit' };
    }
  | { kind: 'long_attack'; cause: `long_attack:${string}`; causeKey: string; evidence: { episodeId: string; hoursOpen: number; stage: number } }
  | { kind: 'debrief_due'; cause: `debrief:${string}`; causeKey: string; evidence: { episodeId: string; endedAt: string } }
  | { kind: 'quiet_tracker'; cause: 'quiet_tracker'; causeKey: string; evidence: { lastCheckinDate: string | null } };

export interface SignalUser extends Records {
  timeZone: string;
  knownTriggers: readonly string[];
  hasLocation: boolean;
  onboardedAt: string;
  /** Null without a location, or when the forecast could not be had: the pressure signal is then simply absent. */
  pressure: PressureForecast | null;
}

export interface PushLogEntry {
  causeKey: string;
  cause: string;
  pushedAt: string;
}

/** The profile's window and cap (times as `HH:MM` or `HH:MM:SS`) and the pushes already sent. */
export interface PushContext {
  timeZone: string | null;
  notifyStart: string;
  notifyEnd: string;
  notifyDailyCap: number;
  pushLog: readonly PushLogEntry[];
}

export type PushSkip =
  | 'no_timezone'
  | 'outside_window'
  | 'cap_zero'
  | 'cap_reached'
  | 'no_signals'
  | 'already_pushed'
  | 'same_cause_24h'
  | 'all_recently_pushed';

export type PushDecision = { causeKey: string; reason: 'send' } | { causeKey: null; reason: PushSkip };

const HOUR_MS = 3_600_000;
// Band midpoints sum exactly; this only absorbs the rounding of a mean's division.
const SLACK = 1e-9;

const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function knownZone(timeZone: string | null): timeZone is string {
  if (timeZone === null || timeZone === '') return false;
  try {
    localDateIn(new Date(0), timeZone);
    return true;
  } catch {
    return false;
  }
}

/** S15: the monitor skips a user it cannot place in a day (no zone, or one the runtime does not know) or not yet onboarded. */
export function monitorSelects(user: { timeZone: string | null; onboardedAt: string | null }): boolean {
  return knownZone(user.timeZone) && user.onboardedAt !== null;
}

/** `weather` chosen at onboarding, or tagged on enough attacks that started in the window. */
export function weatherApplies(user: Pick<SignalUser, 'knownTriggers' | 'episodes' | 'timeZone'>, now: Date, pack: ConditionPack): boolean {
  if (user.knownTriggers.includes('weather')) return true;
  const today = localDateIn(now, user.timeZone);
  const from = addDays(today, 1 - pack.insights.windowDays);
  const tagged = user.episodes.filter((episode) => {
    const date = localDateIn(new Date(episode.startedAt), user.timeZone);
    return episode.triggers.includes('weather') && date >= from && date <= today;
  });
  return tagged.length >= pack.signals.pressure.minTaggedEpisodes;
}

interface Day {
  user: SignalUser;
  now: Date;
  pack: ConditionPack;
  today: string;
  windowStart: string;
}

function dayOf(user: SignalUser, now: Date, pack: ConditionPack): Day {
  const today = localDateIn(now, user.timeZone);
  return { user, now, pack, today, windowStart: addDays(today, 1 - pack.insights.windowDays) };
}

function longAttacks({ user, now, pack }: Day): Signal[] {
  return user.episodes.flatMap((episode): Signal[] => {
    if (episode.endedAt !== null) return [];
    const hoursOpen = Math.floor((now.getTime() - Date.parse(episode.startedAt)) / HOUR_MS);
    const reached = pack.signals.longAttackHours.filter((hours) => hoursOpen >= hours);
    if (reached.length === 0) return [];
    const stage = Math.max(...reached);
    return [
      {
        kind: 'long_attack',
        cause: `long_attack:${episode.id}`,
        causeKey: `long_attack:${episode.id}:${String(stage)}`,
        evidence: { episodeId: episode.id, hoursOpen, stage },
      },
    ];
  });
}

function overuse({ user, now, pack, today }: Day): Signal[] {
  const medications = user.medications.map((med) => ({ id: med.id, kind: med.kind, medicationClass: med.class }));
  const status = overuseStatus(doseDaysForMonth(user.doses, medications, now, user.timeZone), pack);
  const month = today.slice(0, 7);
  const entries = [...pack.medicationClasses.map((scope) => [scope, status.byClass[scope]] as const), ['combined', status.combined] as const];
  return entries.flatMap(([scope, entry]): Signal[] => {
    if (entry.level === 'ok' || entry.limit === null) return [];
    return [
      {
        kind: entry.level === 'limit' ? 'overuse_limit' : 'overuse_warn',
        cause: `overuse:${scope}`,
        causeKey: `overuse:${scope}:${entry.level}:${month}`,
        evidence: { scope, days: entry.days, limit: entry.limit, level: entry.level },
      },
    ];
  });
}

function debriefs({ user, today }: Day): Signal[] {
  const yesterday = addDays(today, -1);
  return user.episodes.flatMap((episode): Signal[] => {
    const { endedAt } = episode;
    if (endedAt === null || episode.debriefedAt !== null || localDateIn(new Date(endedAt), user.timeZone) !== yesterday) return [];
    return [{ kind: 'debrief_due', cause: `debrief:${episode.id}`, causeKey: `debrief:${episode.id}`, evidence: { episodeId: episode.id, endedAt } }];
  });
}

type Night = { localDate: string; band: SleepBand; episodes: readonly RecordEpisode[] };

/** Finished nights in the window with a band, split by whether an attack started in that record day. */
function nightsOf({ user, now, pack, windowStart }: Day): { attack: Night[]; other: Night[] } {
  const recordToday = recordDayOf(now, user.timeZone, pack.dayStartHour);
  const attacksOn = new Map<string, RecordEpisode[]>();
  for (const episode of user.episodes) {
    const day = recordDayOf(new Date(episode.startedAt), user.timeZone, pack.dayStartHour);
    attacksOn.set(day, [...(attacksOn.get(day) ?? []), episode]);
  }
  const nights = user.checkins.flatMap((checkin: RecordCheckin): Night[] =>
    checkin.sleepBand !== null && checkin.localDate < recordToday && checkin.localDate >= windowStart
      ? [{ localDate: checkin.localDate, band: checkin.sleepBand, episodes: attacksOn.get(checkin.localDate) ?? [] }]
      : [],
  );
  return { attack: nights.filter((night) => night.episodes.length > 0), other: nights.filter((night) => night.episodes.length === 0) };
}

function shortSleep(day: Day): Signal | null {
  const { user, pack, today } = day;
  const rules = pack.signals.shortSleep;
  const band = user.checkins.find((checkin) => checkin.localDate === today)?.sleepBand ?? null;
  if (band === null) return null;
  const { attack, other } = nightsOf(day);
  if (attack.length < rules.minAttackNights || other.length === 0) return null;
  const hours = (nights: readonly Night[]): number => mean(nights.map((night) => pack.sleepBandHours[night.band]));
  const attackHours = hours(attack);
  const otherHours = hours(other);
  if (otherHours - attackHours < rules.minGapHours - SLACK) return null;
  if (pack.sleepBandHours[band] >= attackHours - SLACK) return null;
  return {
    kind: 'short_sleep',
    cause: 'short_sleep',
    causeKey: `short_sleep:${today}`,
    evidence: { sleepBand: band, avgAttackNightHours: round(attackHours, 1), attackNights: attack.length, avgOtherNightHours: round(otherHours, 1) },
  };
}

function pressure({ user, now, pack, today }: Day): Signal | null {
  const forecast = user.pressure;
  const rules = pack.signals.pressure;
  if (forecast === null || !weatherApplies(user, now, pack)) return null;
  // A NaN age (an unreadable stamp) fails this test too.
  if (!(now.getTime() - Date.parse(forecast.fetchedAt) <= rules.maxForecastAgeHours * HOUR_MS)) return null;
  // Null hours were dropped from the series, so an hour is found by its time, never by its position.
  const at = (time: number): { hour: string; hPa: number } | null => {
    const index = forecast.hours.findIndex((hour) => Date.parse(hour) === time);
    const hour = forecast.hours[index];
    const hPa = forecast.hPa[index];
    return hour === undefined || hPa === undefined ? null : { hour, hPa };
  };
  const hour = now.getTime() - (now.getTime() % HOUR_MS);
  const first = at(hour);
  const later = at(hour + rules.horizonHours * HOUR_MS);
  if (first === null || later === null) return null;
  const drop = first.hPa - later.hPa;
  if (drop < rules.dropHpa) return null;
  return {
    kind: 'pressure',
    cause: 'pressure',
    causeKey: `pressure:${today}`,
    evidence: { nowHpa: Math.round(first.hPa), laterHpa: Math.round(later.hPa), laterAt: later.hour, dropHpa: round(drop, 1) },
  };
}

function quietTracker({ user, pack, today }: Day): Signal | null {
  const days = pack.signals.quietTrackerDays;
  if (!isTime(user.onboardedAt) || daysBetween(localDateIn(new Date(user.onboardedAt), user.timeZone), today) < days) return null;
  const last = user.checkins.map((checkin) => checkin.localDate).filter((date) => date <= today).sort().at(-1) ?? null;
  if (last !== null && last >= addDays(today, -days)) return null;
  // One signal per quiet stretch: a user who never checked in has a single stretch since onboarding.
  return { kind: 'quiet_tracker', cause: 'quiet_tracker', causeKey: `quiet:${last ?? 'never'}`, evidence: { lastCheckinDate: last } };
}

/** A quiet stretch's length for its copy; `over` when it only is known to pass `days`. */
export type QuietStretch = { days: number; over: boolean };

/**
 * Whole days of a quiet stretch on `now`'s local date: since the last check-in, or since onboarding when there is none
 * in the records. Past the records' window "none" may mean "older than the window", so it reads as over that window.
 * Null for any other signal.
 */
export function quietDaysOf(signal: Signal, user: Pick<SignalUser, 'timeZone' | 'onboardedAt'>, now: Date, pack: ConditionPack): QuietStretch | null {
  if (signal.kind !== 'quiet_tracker') return null;
  const today = localDateIn(now, user.timeZone);
  const last = signal.evidence.lastCheckinDate;
  if (last !== null) return { days: daysBetween(last, today), over: false };
  if (!isTime(user.onboardedAt)) return null;
  const sinceOnboarding = daysBetween(localDateIn(new Date(user.onboardedAt), user.timeZone), today);
  const window = pack.insights.windowDays;
  return sinceOnboarding > window ? { days: window, over: true } : { days: sinceOnboarding, over: false };
}

/**
 * `quiet:never` also stands for a stretch whose last check-in has left the records' window. Once a quiet stretch was
 * pushed and no check-in is in sight, that key is the same stretch again, so it reads as already pushed.
 */
export function withoutRepeatedQuiet(signals: readonly Signal[], pushLog: readonly PushLogEntry[]): Signal[] {
  const quietPushed = pushLog.some((entry) => entry.causeKey.startsWith('quiet:') && entry.causeKey !== 'quiet:never');
  return quietPushed ? signals.filter((signal) => signal.causeKey !== 'quiet:never') : [...signals];
}

const present = <T>(value: T | null): T[] => (value === null ? [] : [value]);

function byPriority(signals: readonly Signal[], pack: ConditionPack): Signal[] {
  const { priority } = pack.signals;
  const rank = (kind: SignalKind): number => {
    const index = priority.indexOf(kind);
    return index === -1 ? priority.length : index;
  };
  // A stable sort keeps a kind's own order: classes in pack order, then combined.
  return [...signals].sort((a, b) => rank(a.kind) - rank(b.kind));
}

const attackOpen = (episodes: readonly RecordEpisode[]): boolean => episodes.some((episode) => episode.endedAt === null);

function suppressed(signals: readonly Signal[], episodes: readonly RecordEpisode[], pack: ConditionPack): Signal[] {
  if (!attackOpen(episodes)) return [...signals];
  return signals.filter((signal) => !pack.signals.suppressDuringAttack.includes(signal.kind));
}

/** Every signal for `now`, highest priority first; `user.timeZone` must be one the runtime knows (`monitorSelects`). */
export function computeSignals(user: SignalUser, now: Date, pack: ConditionPack): Signal[] {
  const day = dayOf(user, now, pack);
  const all = [
    ...longAttacks(day),
    ...overuse(day),
    ...debriefs(day),
    ...present(shortSleep(day)),
    ...present(pressure(day)),
    ...present(quietTracker(day)),
  ];
  return byPriority(suppressed(all, user.episodes, pack), pack);
}

/** The rows Today shows. */
export function todayRows(signals: readonly Signal[], pack: ConditionPack): Signal[] {
  return signals.slice(0, pack.signals.maxOnToday);
}

/** The records a signal counts, for its evidence: the month's doses behind an overuse, the attacks behind short sleep's nights. */
export function signalRecords(signal: Signal, user: SignalUser, now: Date, pack: ConditionPack): { episodeIds: string[]; doseIds: string[] } {
  switch (signal.kind) {
    case 'overuse_warn':
    case 'overuse_limit': {
      const { scope } = signal.evidence;
      const classes: readonly MedicationClass[] = scope === 'combined' ? pack.combinedClasses : [scope];
      const counted = new Set(user.medications.filter((med) => med.kind === 'acute' && classes.includes(med.class)).map((med) => med.id));
      const month = localDateIn(now, user.timeZone).slice(0, 8);
      const doseIds = user.doses
        .filter((dose) => counted.has(dose.medicationId) && localDateIn(new Date(dose.takenAt), user.timeZone).startsWith(month))
        .map((dose) => dose.id);
      return { episodeIds: [], doseIds };
    }
    case 'short_sleep':
      return { episodeIds: nightsOf(dayOf(user, now, pack)).attack.flatMap((night) => night.episodes.map((episode) => episode.id)), doseIds: [] };
    case 'long_attack':
    case 'debrief_due':
      return { episodeIds: [signal.evidence.episodeId], doseIds: [] };
    case 'pressure':
    case 'quiet_tracker':
      return { episodeIds: [], doseIds: [] };
  }
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function secondsOf(clock: string): number | null {
  const match = CLOCK.exec(clock);
  if (match === null) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

/** `[start, end)` on the local clock; a start after the end crosses midnight, and start equal to end is an empty window. */
export function insideWindow(localClock: string, start: string, end: string): boolean {
  const time = secondsOf(localClock);
  const from = secondsOf(start);
  const to = secondsOf(end);
  if (time === null || from === null || to === null || from === to) return false;
  return from < to ? time >= from && time < to : time >= from || time < to;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function localClockIn(now: Date, timeZone: string): string {
  let format = clockFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(now);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}:${part('second')}`;
}

const skip = (reason: PushSkip): PushDecision => ({ causeKey: null, reason });

/**
 * The one signal to push this run, or why none. Every user is evaluated each hour; the window only decides
 * whether to push. Pushes counted against the cap are those on today's local date.
 */
export function decidePush(signals: readonly Signal[], ctx: PushContext, now: Date, pack: ConditionPack): PushDecision {
  const { timeZone } = ctx;
  if (!knownZone(timeZone)) return skip('no_timezone');
  if (!insideWindow(localClockIn(now, timeZone), ctx.notifyStart, ctx.notifyEnd)) return skip('outside_window');
  if (ctx.notifyDailyCap <= 0) return skip('cap_zero');
  if (signals.length === 0) return skip('no_signals');
  const today = localDateIn(now, timeZone);
  const pushedToday = ctx.pushLog.filter((entry) => isTime(entry.pushedAt) && localDateIn(new Date(entry.pushedAt), timeZone) === today);
  if (pushedToday.length >= ctx.notifyDailyCap) return skip('cap_reached');
  const pushedKeys = new Set(ctx.pushLog.map((entry) => entry.causeKey));
  const since = now.getTime() - pack.push.sameCauseHours * HOUR_MS;
  const recentCauses = new Set(ctx.pushLog.filter((entry) => Date.parse(entry.pushedAt) > since).map((entry) => entry.cause));
  const reasons: PushSkip[] = [];
  for (const signal of byPriority(signals, pack)) {
    if (pushedKeys.has(signal.causeKey)) reasons.push('already_pushed');
    else if (recentCauses.has(signal.cause)) reasons.push('same_cause_24h');
    else return { causeKey: signal.causeKey, reason: 'send' };
  }
  const [only] = reasons;
  return skip(reasons.length === 1 && only !== undefined ? only : 'all_recently_pushed');
}

// --- Stored rows ---------------------------------------------------------------------------------

const SLEEP_BANDS: Readonly<Record<SleepBand, true>> = { lt5: true, '5_6': true, '6_7': true, '7_8': true, gt8: true };
const SCOPES: Readonly<Record<MedicationClass | 'combined', true>> = {
  simple_analgesic: true,
  triptan: true,
  ergot: true,
  opioid: true,
  combination_analgesic: true,
  gepant: true,
  other: true,
  combined: true,
};
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const keyOf = <T extends string>(options: Readonly<Record<T, true>>, value: unknown): T | undefined =>
  typeof value === 'string' && Object.hasOwn(options, value) ? (value as T) : undefined;
const prefixed = <P extends string>(value: string, prefix: P): value is `${P}${string}` => value.startsWith(prefix) && value.length > prefix.length;

/** A stored `signals` row (`kind, cause, cause_key, evidence`) back to a Signal; null for any unknown kind or evidence shape. */
export function signalFromRow(row: unknown): Signal | null {
  if (!isRecord(row) || !isText(row.cause_key) || typeof row.cause !== 'string' || !isRecord(row.evidence)) return null;
  const { cause, cause_key: causeKey, evidence } = row;
  switch (row.kind) {
    case 'pressure': {
      const { nowHpa, laterHpa, laterAt, dropHpa } = evidence;
      if (cause !== 'pressure' || !isNumber(nowHpa) || !isNumber(laterHpa) || !isTime(laterAt) || !isNumber(dropHpa)) return null;
      return { kind: 'pressure', cause, causeKey, evidence: { nowHpa, laterHpa, laterAt, dropHpa } };
    }
    case 'short_sleep': {
      const sleepBand = keyOf(SLEEP_BANDS, evidence.sleepBand);
      const { avgAttackNightHours, attackNights, avgOtherNightHours } = evidence;
      if (cause !== 'short_sleep' || sleepBand === undefined || !isNumber(avgAttackNightHours) || !isNumber(attackNights) || !isNumber(avgOtherNightHours)) return null;
      return { kind: 'short_sleep', cause, causeKey, evidence: { sleepBand, avgAttackNightHours, attackNights, avgOtherNightHours } };
    }
    case 'overuse_warn':
    case 'overuse_limit': {
      const scope = keyOf(SCOPES, evidence.scope);
      const { days, limit, level } = evidence;
      const expected = row.kind === 'overuse_limit' ? 'limit' : 'warn';
      if (!prefixed(cause, 'overuse:') || scope === undefined || !isNumber(days) || !isNumber(limit) || level !== expected) return null;
      return { kind: row.kind, cause, causeKey, evidence: { scope, days, limit, level: expected } };
    }
    case 'long_attack': {
      const { episodeId, hoursOpen, stage } = evidence;
      if (!prefixed(cause, 'long_attack:') || !isText(episodeId) || !isNumber(hoursOpen) || !isNumber(stage)) return null;
      return { kind: 'long_attack', cause, causeKey, evidence: { episodeId, hoursOpen, stage } };
    }
    case 'debrief_due': {
      const { episodeId, endedAt } = evidence;
      if (!prefixed(cause, 'debrief:') || !isText(episodeId) || !isTime(endedAt)) return null;
      return { kind: 'debrief_due', cause, causeKey, evidence: { episodeId, endedAt } };
    }
    case 'quiet_tracker': {
      const { lastCheckinDate } = evidence;
      const last = lastCheckinDate === null ? null : typeof lastCheckinDate === 'string' && LOCAL_DATE.test(lastCheckinDate) ? lastCheckinDate : undefined;
      if (cause !== 'quiet_tracker' || last === undefined) return null;
      return { kind: 'quiet_tracker', cause, causeKey, evidence: { lastCheckinDate: last } };
    }
    default:
      return null;
  }
}

/**
 * `computed` (pressure absent: only the monitor has the forecast) with the stored pressure signal for today, re-ordered
 * by priority. `user` and `now` are those `computed` came from: a stored row for another day, or one during an open
 * attack, is left out.
 */
export function withStoredPressure(
  computed: readonly Signal[],
  stored: Signal | null,
  user: Pick<SignalUser, 'timeZone' | 'episodes'>,
  now: Date,
  pack: ConditionPack,
): Signal[] {
  const today = localDateIn(now, user.timeZone);
  if (stored === null || stored.kind !== 'pressure' || stored.causeKey !== `pressure:${today}`) return byPriority(computed, pack);
  return byPriority(suppressed([...computed.filter((signal) => signal.kind !== 'pressure'), stored], user.episodes, pack), pack);
}
